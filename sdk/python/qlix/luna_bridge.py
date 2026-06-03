"""Bridge between Qlix's signed audit pipeline and bundled Luna execution.

Luna ships as :mod:`qlix.luna` (plain subpackage, not a pip dependency).

:class:`QlixToolExecutor` subclasses Luna :class:`~qlix.luna.tools._stubs.ToolExecutor`
and wraps each ``execute(tool_call)`` in scope/JIT checks, ``/actions/start``, real
execution, and ``/actions/complete``.

Sync ⇄ async bridge: ``ToolExecutor.execute`` is synchronous, but
``QlixSDK.start_action`` and friends are async. The helper :func:`_run_sync`
runs an async coroutine from sync code, falling back to a worker thread when
an event loop is already running (FastAPI servers, async tests, etc.).
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import TYPE_CHECKING, Any, Awaitable, Coroutine, TypeVar

from qlix.luna.core.types import ToolCall, ToolResult
from qlix.luna.tools._stubs import BaseTool, ToolExecutor

from .exceptions import HttpError, PermissionDeniedError, QlixError, ScopeError
from .sdk import QlixSDK

if TYPE_CHECKING:
    from qlix.luna.system.core import LunaSystem


T = TypeVar("T")


def wrap_tool_executor_with_qlix(system: "LunaSystem", qlix: QlixSDK) -> None:
    """Replace ``system.tool_executor`` with :class:`QlixToolExecutor` (same tool list, audited)."""
    te = system.tool_executor
    if te is None or isinstance(te, QlixToolExecutor):
        return
    wrapped = QlixToolExecutor(
        list(te._tools.values()),
        te._bus,
        interactive=te._interactive,
        confirm_callback=te._confirm_callback,
        default_timeout=te._default_timeout,
        capability_policy=te._capability_policy,
        agent_id=te._agent_id,
        boundary_guard=te._boundary_guard,
        qlix=qlix,
    )
    system.tool_executor = wrapped
    if system.skill_manager is not None:
        system.skill_manager.set_tool_executor(wrapped)


def _run_sync(coro: Coroutine[Any, Any, T]) -> T:
    """Drive an async coroutine from sync code.

    Tries the simple path first (no running loop → ``asyncio.run``). If a loop
    is already running on this thread, hand the coroutine to a fresh thread
    with its own loop so we don't deadlock.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    holder: dict[str, Any] = {}

    def runner() -> None:
        try:
            holder["value"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001 — re-raised below
            holder["error"] = exc

    thread = threading.Thread(target=runner, name="qlix-bridge", daemon=True)
    thread.start()
    thread.join()
    if "error" in holder:
        raise holder["error"]
    return holder["value"]


def _classify_risk(tool: BaseTool | None) -> str:
    """Map an Luna tool to a Qlix risk level.

    Heuristics — easy to refine later:
      - Tools that already declare ``requires_confirmation=True`` → ``high``.
      - Tools with non-zero ``cost_estimate`` → ``medium``.
      - Anything else → ``low``.
    """
    if tool is None:
        return "low"
    spec = tool.spec
    if getattr(spec, "requires_confirmation", False):
        return "high"
    if getattr(spec, "cost_estimate", 0.0) > 0:
        return "medium"
    return "low"


def _result_to_payload(result: ToolResult) -> dict[str, Any]:
    """Reduce a ToolResult into a JSON-safe dict for /actions/complete."""
    return {
        "tool_name": result.tool_name,
        "success": bool(result.success),
        "content_preview": (result.content or "")[:2_000],
        "latency_seconds": float(getattr(result, "latency_seconds", 0.0) or 0.0),
        "cost_usd": float(getattr(result, "cost_usd", 0.0) or 0.0),
    }


class QlixToolExecutor(ToolExecutor):
    """ToolExecutor that audits and bills every tool call through Qlix.

    Lifecycle of one ``execute(tool_call)``:

        1. ``ScopeError`` immediately if ``tool_call.name`` is not in
           ``identity.permission_scopes`` → tool is never invoked.
        2. JIT scope? Block on user approval (raises ``PermissionDeniedError``
           on deny, ``JITTimeoutError`` after 120 s).
        3. POST /api/v1/actions/start → receive ``action_id``. If the backend
           rejects (bad signature, stale clock, scope guard) → tool is not run.
        4. Run the parent ``ToolExecutor.execute`` synchronously inside a
           worker thread.
        5. POST /api/v1/actions/complete with ``success`` taken from
           ``ToolResult.success``. The backend debits the wallet only on
           ``success=true``.
        6. Return the original ``ToolResult`` to the orchestrator.
    """

    def __init__(self, *args: Any, qlix: QlixSDK, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._qlix = qlix

    def execute(self, tool_call: ToolCall) -> ToolResult:
        action_type = tool_call.name

        if not self._qlix.identity.has_scope(action_type):
            raise ScopeError(
                f"Tool '{action_type}' is not in this agent's permission_scopes"
            )

        try:
            payload = json.loads(tool_call.arguments) if tool_call.arguments else {}
        except json.JSONDecodeError:
            payload = {"raw_arguments": tool_call.arguments or ""}

        tool = self._tools.get(action_type)
        risk_level = _classify_risk(tool)

        return _run_sync(
            self._execute_with_audit(
                tool_call=tool_call,
                action_type=action_type,
                payload=payload,
                risk_level=risk_level,
            )
        )

    async def _execute_with_audit(
        self,
        *,
        tool_call: ToolCall,
        action_type: str,
        payload: dict[str, Any],
        risk_level: str,
    ) -> ToolResult:
        jit_token: str | None = None
        if self._qlix.identity.is_jit(action_type):
            approval = await self._qlix.jit.request_and_wait(
                action_type=action_type,
                payload=payload,
            )
            jit_token = approval.jit_token

        try:
            action_id = await self._qlix.start_action(
                action_type=action_type,
                payload=payload,
                risk_level=risk_level,
                jit_token=jit_token,
            )
        except PermissionDeniedError:
            raise
        except (HttpError, QlixError):
            # Backend refused this action — the tool MUST NOT run.
            raise

        run_super = super().execute  # bind once, run in a worker thread.
        try:
            result: ToolResult = await asyncio.to_thread(run_super, tool_call)
        except BaseException as exc:
            # Tool raised — record the failure tail then re-raise.
            try:
                await self._qlix.complete_action_failure(
                    action_id=action_id,
                    action_type=action_type,
                    exc=exc,
                )
            except Exception:  # noqa: BLE001 — never mask the original
                pass
            raise

        if not isinstance(result, ToolResult):
            # Defensive: some custom tools might return raw values.
            result = ToolResult(
                tool_name=action_type,
                content=str(result),
                success=True,
            )

        if result.success:
            await self._qlix.complete_action_success(
                action_id=action_id,
                action_type=action_type,
                result=_result_to_payload(result),
            )
        else:
            await self._qlix.complete_action_failure(
                action_id=action_id,
                action_type=action_type,
                error_message=result.content,
                error_code="ToolReportedFailure",
                result=_result_to_payload(result),
            )

        return result


__all__ = ["QlixToolExecutor", "wrap_tool_executor_with_qlix"]
