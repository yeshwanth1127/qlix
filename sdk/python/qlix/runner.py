"""AgentRunner — the execution engine for @qlix.agent-decorated classes.

Usage::

    import qlix

    async with qlix.runner(MyAgent) as r:
        result = await r.run("Summarise my emails from today")
        print(result.content)
        print(f"Took {result.duration_ms}ms, {result.turns} turn(s)")

Architecture
------------
The runner maintains its own tool-calling loop rather than delegating to
Luna's internal OrchestratorAgent. This gives the ADK full control over
billing boundaries:

  * Class tools (@qlix.tool methods) — called via their decorated wrapper,
    which handles scope-check, JIT approval, and billing through sdk.run().
  * Luna built-in tools — called via the underlying BaseTool.execute()
    directly. Billing for these is a future integration point (tracked
    separately from the ADK billing path).

Tool merge order (Q2=b):
  Luna built-in tools + @qlix.tool class methods (class wins on name conflict)
  = Final tool registry used by the LLM and the runner's dispatch loop.

Concurrency
-----------
system.ask() / engine.generate() is not safe to call concurrently from a
single LunaSystem instance. The runner holds an asyncio.Lock for the
duration of each run() call. One task at a time through Luna. Replace the
lock with a queue when concurrency is needed in a later version.

Statefulness
------------
The runner is stateful per instance (Q3=b). History is held in-memory and
appended to on every run() call. Create a new AgentRunner instance for each
independent conversation.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Type

from .agent import AgentMeta
from .tool import ToolMeta

_MAX_TURNS = 10


# ---------------------------------------------------------------------------
# RunResult
# ---------------------------------------------------------------------------


@dataclass
class RunResult:
    """Result of a single agent run.

    Carries everything the backend and dashboard need:
    - ``content``     — the agent's final response text.
    - ``turns``       — how many LLM round-trips were needed.
    - ``tool_calls``  — ordered list of tool names that fired.
    - ``metadata``    — pass-through dict for any extra engine metadata.
    - ``agent_did``   — DID of the agent that produced this result.
                        Preserves accountability when RunResult is stored or
                        forwarded to the backend.
    - ``duration_ms`` — wall-clock duration from run() entry to return.
                        Used by the billing system and the dashboard.
    - ``task_id``     — UUID generated at run() call time. Used as the
                        audit-trail key and as the polling ID for
                        GET /run/{task_id} in the HTTP server.
    """

    content: str
    turns: int
    tool_calls: list[str]
    metadata: dict[str, Any]
    agent_did: str
    duration_ms: int
    task_id: str


# ---------------------------------------------------------------------------
# AgentRunner
# ---------------------------------------------------------------------------


class AgentRunner:
    """Stateful runner for a single @qlix.agent-decorated class.

    One instance = one conversation thread. History is kept in memory and
    extended on every run() call. Create a fresh instance for a new
    conversation.

    Boot sequence
    ~~~~~~~~~~~~~
    1. Obtain or receive a QlixSDK instance.
    2. Call sdk.start() → LunaSystem (raises on failure, no silent swallow).
    3. Instantiate the agent class to bind its methods.
    4. Merge class tools + Luna built-in tools into the runner's tool registry.
    5. Build LLM tool definitions for the combined registry.

    Parameters
    ----------
    agent_class:
        A class decorated with @qlix.agent.
    sdk:
        Optional QlixSDK instance. If omitted, the runner uses the active
        global SDK registered by QlixSDK.__init__.
    """

    def __init__(self, agent_class: Type[Any], *, sdk: Any = None) -> None:
        if not hasattr(agent_class, "_qlix_agent"):
            raise TypeError(
                f"{agent_class!r} is not decorated with @qlix.agent. "
                f"Apply @qlix.agent(...) before passing to AgentRunner."
            )
        self._agent_class = agent_class
        self._agent_meta: AgentMeta = agent_class._qlix_agent
        self._sdk = sdk
        self._system: Any = None  # LunaSystem, set in boot()
        self._lock = asyncio.Lock()  # serialise concurrent run() calls
        self._history: list[Any] = []  # list[Message], stateful per instance
        self._class_tool_map: dict[str, Callable[..., Any]] = {}
        self._luna_tool_map: dict[str, Any] = {}  # name → BaseTool
        self._all_tool_defs: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def boot(self) -> None:
        """Boot the Luna runtime and wire up tool registries.

        Raises ``RuntimeError`` immediately on failure — the runner is never
        left in a partially initialised state.
        """
        if self._sdk is None:
            from .luna._gate import get_active_sdk
            self._sdk = get_active_sdk()

        if self._sdk is None:
            raise RuntimeError(
                "No active QlixSDK. Construct QlixSDK() (with a valid agent.json "
                "or QLIX_DEV=1) before booting AgentRunner."
            )

        try:
            system = await self._sdk.start()
        except Exception as exc:
            raise RuntimeError(
                f"AgentRunner failed to boot Luna system: {exc}"
            ) from exc

        # Override model from manifest (if specified)
        if self._agent_meta.model:
            system.model = self._agent_meta.model

        # Instantiate agent class — gives us bound methods with self captured
        instance = self._agent_class()

        # --- Class tool map: fn_name → bound method ----------------------
        # Use the Python function name (no dots) as the LLM-visible tool name.
        # Billing is handled inside the @qlix.tool wrapper when the method fires.
        for method_name in dir(instance):
            try:
                bound = getattr(instance, method_name)
            except Exception:
                continue
            if callable(bound) and hasattr(bound, "_qlix_tool"):
                meta = bound._qlix_tool
                if isinstance(meta, ToolMeta):
                    self._class_tool_map[method_name] = bound

        # --- Luna built-in tool map: name → BaseTool (class wins on conflict) ---
        if system.tool_executor is not None and hasattr(system.tool_executor, "_tools"):
            for name, luna_tool in system.tool_executor._tools.items():
                if name not in self._class_tool_map:
                    self._luna_tool_map[name] = luna_tool

        # --- Combined LLM tool definitions ---
        defs: list[dict[str, Any]] = []

        for fn_name, bound in self._class_tool_map.items():
            meta: ToolMeta = bound._qlix_tool
            defs.append({
                "type": "function",
                "function": {
                    "name": fn_name,
                    "description": meta.description,
                    "parameters": meta.parameters,
                },
            })

        for luna_tool in self._luna_tool_map.values():
            try:
                defs.append(luna_tool.to_openai_function())
            except Exception:
                pass  # skip tools that cannot serialise their spec

        self._all_tool_defs = defs
        self._system = system

    async def close(self) -> None:
        """Tear down the Luna runtime and release the SDK."""
        if self._sdk is not None:
            try:
                await self._sdk.aclose()
            except Exception:
                pass
        self._system = None

    async def __aenter__(self) -> "AgentRunner":
        await self.boot()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(
        self,
        message: str,
        *,
        allowed_tools: list[str] | None = None,
    ) -> RunResult:
        """Send a message to the agent and return the result.

        Blocks until the agent has finished its tool-calling loop and produced
        a final answer. Appends to conversation history so subsequent calls
        continue the same thread.

        Parameters
        ----------
        message:
            The user message to send.

        Returns
        -------
        RunResult
            Contains the final content, turn count, tool names that fired,
            agent DID, wall-clock duration, and a unique task_id for audit.
        """
        if self._system is None:
            raise RuntimeError(
                "AgentRunner is not booted. "
                "Use 'async with runner:' or call boot() first."
            )

        task_id = str(uuid.uuid4())
        t0 = int(time.time() * 1000)

        async with self._lock:
            content, turns, tool_calls_made, metadata = await self._tool_loop(
                message,
                allowed_tools=set(allowed_tools) if allowed_tools else None,
            )

        return RunResult(
            content=content,
            turns=turns,
            tool_calls=tool_calls_made,
            metadata=metadata,
            agent_did=self._sdk.identity.did,
            duration_ms=int(time.time() * 1000) - t0,
            task_id=task_id,
        )

    # ------------------------------------------------------------------
    # Internal: tool-calling loop
    # ------------------------------------------------------------------

    async def _tool_loop(
        self,
        message: str,
        *,
        allowed_tools: set[str] | None = None,
    ) -> tuple[str, int, list[str], dict[str, Any]]:
        from qlix.luna.core.types import Message, Role, ToolCall as LunaToolCall

        self._history.append(Message(role=Role.USER, content=message))

        # Assemble messages: system prompt (if any) + full history
        messages: list[Any] = []
        if self._agent_meta.system_prompt:
            messages.append(
                Message(role=Role.SYSTEM, content=self._agent_meta.system_prompt)
            )
        messages.extend(self._history)

        if self._all_tool_defs:
            if allowed_tools is None:
                tool_defs = self._all_tool_defs
            else:
                tool_defs = [
                    d
                    for d in self._all_tool_defs
                    if d.get("function", {}).get("name") in allowed_tools
                ]
        else:
            tool_defs = None
        turns = 0
        tool_calls_made: list[str] = []
        content = ""
        metadata: dict[str, Any] = {}

        while turns < _MAX_TURNS:
            # engine.generate() is synchronous — run in thread to avoid
            # blocking the event loop during LLM inference.
            result: dict[str, Any] = await asyncio.to_thread(
                self._system.engine.generate,
                messages,
                model=self._system.model,
                temperature=self._system.config.intelligence.temperature,
                max_tokens=self._system.config.intelligence.max_tokens,
                tools=tool_defs,
            )
            turns += 1
            content = result.get("content", "")
            metadata = result.get("usage", {})

            raw_tool_calls: list[dict[str, Any]] = result.get("tool_calls") or []
            if not raw_tool_calls:
                # No tool calls — agent is done
                self._history.append(Message(role=Role.ASSISTANT, content=content))
                break

            # Normalise tool call dicts → LunaToolCall objects
            luna_tool_calls: list[LunaToolCall] = []
            for tc in raw_tool_calls:
                fn_block = tc.get("function", tc)
                tc_id = tc.get("id") or str(uuid.uuid4())
                tc_name: str = fn_block.get("name", "")
                tc_args = fn_block.get("arguments", "{}")
                if isinstance(tc_args, dict):
                    tc_args = json.dumps(tc_args)
                luna_tool_calls.append(
                    LunaToolCall(id=tc_id, name=tc_name, arguments=tc_args)
                )

            # Append assistant turn with tool_calls to history and message list
            asst_msg = Message(
                role=Role.ASSISTANT,
                content=content,
                tool_calls=luna_tool_calls,
            )
            self._history.append(asst_msg)
            messages.append(asst_msg)

            # Execute each tool and feed results back
            for ltc in luna_tool_calls:
                tool_calls_made.append(ltc.name)
                tool_content = await self._dispatch_tool(ltc, allowed_tools=allowed_tools)
                tool_msg = Message(
                    role=Role.TOOL,
                    content=tool_content,
                    tool_call_id=ltc.id,
                )
                self._history.append(tool_msg)
                messages.append(tool_msg)

        return content, turns, tool_calls_made, metadata

    async def _dispatch_tool(
        self,
        tool_call: Any,
        *,
        allowed_tools: set[str] | None = None,
    ) -> str:
        """Route a tool call to the right handler and return a string result."""
        name: str = tool_call.name
        if allowed_tools is not None and name not in allowed_tools:
            return f"[tool blocked] '{name}' is not in selected skills"
        try:
            args: dict[str, Any] = (
                json.loads(tool_call.arguments) if tool_call.arguments else {}
            )
        except json.JSONDecodeError:
            args = {}

        # --- Class tool: async, billing inside @qlix.tool wrapper ---
        bound = self._class_tool_map.get(name)
        if bound is not None:
            try:
                result = await bound(**args)
                return str(result) if result is not None else ""
            except Exception as exc:
                return f"[tool error] {exc}"

        # --- Luna built-in tool: execute through wrapped system executor ---
        # This keeps scope/JIT/audit enforcement active for built-in tools.
        luna_tool = self._luna_tool_map.get(name)
        if luna_tool is not None and self._system is not None and self._system.tool_executor is not None:
            try:
                tool_result = await asyncio.to_thread(self._system.tool_executor.execute, tool_call)
                return getattr(tool_result, "content", str(tool_result)) or ""
            except Exception as exc:
                return f"[tool error] {exc}"

        return f"[unknown tool] {name}"


# ---------------------------------------------------------------------------
# Convenience factory
# ---------------------------------------------------------------------------


def runner(agent_class: Type[Any], *, sdk: Any = None) -> AgentRunner:
    """Return an AgentRunner for the given @qlix.agent class.

    Usage::

        async with qlix.runner(MyAgent) as r:
            result = await r.run("Hello")
    """
    return AgentRunner(agent_class, sdk=sdk)


__all__ = ["AgentRunner", "RunResult", "runner"]
