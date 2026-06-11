"""Cloud/hybrid runner: external MCP server tools under Qlix governance.

Each MCP tool is offered to the model as ``mcp__<slug>__<tool>``. Every call is
wrapped in the signed Qlix action lifecycle:

    (optional JIT approval) → POST /api/v1/actions/start (signed)
       → MCPClient.call_tool(...) on the bound server
       → POST /api/v1/actions/complete (signed)

so the hash-chained audit ledger, JIT enforcement, and pay-per-success billing all
apply to third-party MCP tools for free. Server configs (endpoint/headers for HTTP,
command/env for stdio) are delivered per-run in the ``runs/poll`` response.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from typing import Any

from .identity import AgentIdentity

# LLM-facing tool name prefix. Names must match ^[a-zA-Z0-9_-]+$ for OpenAI tools.
_NS_PREFIX = "mcp__"
_NS_SEP = "__"
# Provider hard limit on a tool/function name (OpenAI + Anthropic both cap at 64).
_NAME_MAX = 64
# Anything outside this class is illegal in a provider tool name.
_UNSAFE = re.compile(r"[^a-zA-Z0-9_-]")


def _granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def _scope_for(slug: str, tool: str) -> str:
    return f"mcp.{slug}.{tool}"


def _wildcard_for(slug: str) -> str:
    return f"mcp.{slug}.*"


def _scope_granted(granted: set[str], slug: str, tool: str) -> bool:
    return _scope_for(slug, tool) in granted or _wildcard_for(slug) in granted


def _is_jit(identity: AgentIdentity, slug: str, tool: str) -> bool:
    jit = set(identity.jit_scopes)
    return _scope_for(slug, tool) in jit or _wildcard_for(slug) in jit


def _sanitize_segment(name: str) -> str:
    """Make an MCP tool name safe to embed in a provider function name.

    Third-party servers may advertise tool names containing ``.``, ``:``, spaces,
    etc. which providers reject (names must match ``^[a-zA-Z0-9_-]+$``). We replace
    every illegal char with ``_``. When that substitution changes the string (so the
    mapping is no longer 1:1 and two distinct tools could collide), we append a short
    stable hash of the *original* name to keep the result unique. The original name is
    never used to call the server — the executor index maps the namespaced name back to
    the unmodified tool name — so this only needs to be deterministic, not reversible.
    """
    safe = _UNSAFE.sub("_", name)
    if safe != name:
        digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:6]
        safe = f"{safe}_{digest}"
    return safe or "tool"


def _namespaced(slug: str, tool: str) -> str:
    safe_slug = _UNSAFE.sub("-", slug)
    name = f"{_NS_PREFIX}{safe_slug}{_NS_SEP}{_sanitize_segment(tool)}"
    if len(name) > _NAME_MAX:
        # Truncate but keep uniqueness by hashing the full (pre-truncation) name.
        digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]
        name = f"{name[: _NAME_MAX - len(digest) - 1]}_{digest}"
    return name


def is_mcp_tool(tool_name: str) -> bool:
    return tool_name.startswith(_NS_PREFIX)


def _server_allowed_for_runtime(transport: str, runner_runtime: str) -> bool:
    if transport == "stdio":
        # A local subprocess only exists on the user's machine (hybrid runner).
        return runner_runtime == "hybrid"
    return transport == "http"  # http works on cloud + hybrid


def _coerce_servers(mcp_servers: Any) -> list[dict[str, Any]]:
    if not isinstance(mcp_servers, list):
        return []
    out: list[dict[str, Any]] = []
    for s in mcp_servers:
        if isinstance(s, dict) and s.get("slug"):
            out.append(s)
    return out


def openai_mcp_tool_definitions(
    identity: AgentIdentity,
    mcp_servers: Any,
    skill_filter: list[str] | None,
    *,
    runner_runtime: str,
) -> list[dict[str, Any]]:
    """OpenAI tool defs for every bound MCP tool the agent is scoped to use."""
    servers = _coerce_servers(mcp_servers)
    if not servers:
        return []
    granted = _granted_scopes(identity)

    filt: set[str] | None = None
    dotted_filter = False
    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        dotted_filter = any("." in s for s in filt)

    out: list[dict[str, Any]] = []
    for server in servers:
        slug = str(server.get("slug"))
        transport = str(server.get("transport") or "http")
        if not _server_allowed_for_runtime(transport, runner_runtime):
            continue
        for tool in server.get("tools") or []:
            if not isinstance(tool, dict):
                continue
            name = str(tool.get("name") or "")
            if not name:
                continue
            if not _scope_granted(granted, slug, name):
                continue
            if filt is not None:
                if dotted_filter:
                    if not (_scope_for(slug, name) in filt or _wildcard_for(slug) in filt):
                        continue
                else:
                    if not (_namespaced(slug, name) in filt or name in filt):
                        continue
            schema = tool.get("inputSchema")
            if not isinstance(schema, dict):
                schema = {"type": "object", "properties": {}}
            description = str(tool.get("description") or f"{name} (via {slug} MCP server)")
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": _namespaced(slug, name),
                        "description": description[:1024],
                        "parameters": schema,
                    },
                }
            )
    return out


def _format_call_result(result: dict[str, Any]) -> tuple[bool, str]:
    """Turn an MCP tools/call result into (is_error, text)."""
    is_error = bool(result.get("isError"))
    parts: list[str] = []
    for item in result.get("content") or []:
        if isinstance(item, dict):
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                parts.append(item["text"])
            else:
                parts.append(json.dumps(item, ensure_ascii=False))
    text = "\n".join(parts) if parts else json.dumps(result, ensure_ascii=False)
    return is_error, text


class _McpConnectionPool:
    """Lazily opens and caches one MCPClient per server slug for the run.

    Calls to the same server are serialized (httpx.Client / stdio subprocess are not
    safe under concurrent use); different servers run in parallel.
    """

    def __init__(self, servers: list[dict[str, Any]]) -> None:
        self._by_slug: dict[str, dict[str, Any]] = {str(s["slug"]): s for s in servers}
        self._clients: dict[str, Any] = {}
        self._locks: dict[str, asyncio.Lock] = {s: asyncio.Lock() for s in self._by_slug}

    def _build_client(self, server: dict[str, Any]) -> Any:
        from .luna.mcp.client import MCPClient
        from .luna.mcp.transport import StdioTransport, StreamableHTTPTransport

        transport_kind = str(server.get("transport") or "http")
        if transport_kind == "stdio":
            command = str(server.get("command") or "")
            args = [str(a) for a in (server.get("args") or [])]
            if not command:
                raise RuntimeError("stdio MCP server has no command")
            transport = StdioTransport([command, *args], env=server.get("env") or {})
        else:
            url = str(server.get("endpointUrl") or "")
            if not url:
                raise RuntimeError("http MCP server has no endpointUrl")
            transport = StreamableHTTPTransport(url, headers=server.get("headers") or {})
        client = MCPClient(transport)
        client.initialize()
        return client

    async def call(self, slug: str, tool: str, arguments: dict[str, Any]) -> tuple[bool, str]:
        server = self._by_slug.get(slug)
        if server is None:
            return True, f"MCP server '{slug}' is not bound to this agent"
        lock = self._locks.setdefault(slug, asyncio.Lock())
        async with lock:
            client = self._clients.get(slug)
            if client is None:
                client = await asyncio.to_thread(self._build_client, server)
                self._clients[slug] = client
            result = await asyncio.to_thread(client.call_tool, tool, arguments)
        return _format_call_result(result if isinstance(result, dict) else {"content": [], "isError": True})

    def close(self) -> None:
        """Synchronously close every open client (stdio subprocess / httpx session)."""
        for client in self._clients.values():
            try:
                client.close()
            except Exception:
                pass
        self._clients.clear()

    async def aclose(self) -> None:
        await asyncio.to_thread(self.close)


def _mode_for(server: dict[str, Any]) -> str:
    """`proxy` (http → backend executes) or `local` (stdio → runner executes)."""
    mode = server.get("mode")
    if mode in ("proxy", "local"):
        return str(mode)
    return "local" if str(server.get("transport") or "http") == "stdio" else "proxy"


class _ProxyExecutor:
    """Executes http MCP tools by calling the Qlix backend proxy, so credentials/OAuth tokens
    stay on the backend and never reach the runner."""

    def __init__(self, backend_url: str, runner_token: str, agent_id: str) -> None:
        self._base = (backend_url or "").rstrip("/")
        self._token = runner_token or ""
        self._agent_id = agent_id

    async def call(self, slug: str, tool: str, arguments: dict[str, Any]) -> tuple[bool, str]:
        if not self._base or not self._token:
            return True, "MCP proxy is not configured on this runner (missing backend URL or runner token)"
        import httpx

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=10.0, read=120.0, write=120.0, pool=10.0)
            ) as client:
                resp = await client.post(
                    f"{self._base}/api/v1/mcp/proxy/call",
                    headers={"X-QLIX-Runner-Token": self._token},
                    json={"agentId": self._agent_id, "server": slug, "tool": tool, "arguments": arguments},
                )
        except Exception as exc:  # noqa: BLE001
            return True, f"MCP proxy request failed: {exc}"

        if resp.status_code >= 400:
            try:
                msg = resp.json().get("error", {}).get("message") or resp.text
            except Exception:  # noqa: BLE001
                msg = resp.text
            return True, f"MCP proxy error ({resp.status_code}): {msg}"
        try:
            data = resp.json()
        except Exception:  # noqa: BLE001
            return True, "MCP proxy returned a non-JSON response"
        return _format_call_result({"isError": data.get("isError"), "content": data.get("content") or []})


def build_mcp_tool_executors(
    *,
    identity: AgentIdentity,
    qlix_sdk: Any,
    mcp_servers: Any,
    runner_runtime: str,
    skill_filter: list[str] | None = None,
    backend_url: str = "",
    runner_token: str = "",
    agent_id: str = "",
) -> dict[str, Any]:
    """Async executors for each offered MCP tool, wrapped in Qlix governance.

    Returns a mapping of ``mcp__<slug>__<tool>`` → async ``(args_json) -> str``. http servers
    execute via the backend proxy; stdio servers run locally through :class:`_McpConnectionPool`
    (closed when the next run builds, or in QlixSDK.aclose()).
    """
    servers = _coerce_servers(mcp_servers)
    defs = openai_mcp_tool_definitions(identity, servers, skill_filter, runner_runtime=runner_runtime)
    if not defs:
        return {}

    mode_by_slug = {str(s.get("slug")): _mode_for(s) for s in servers}

    # Map namespaced tool name → (slug, tool, governance, mode) for the offered set.
    offered = {d["function"]["name"] for d in defs}
    index: dict[str, tuple[str, str, str, str]] = {}
    for server in servers:
        slug = str(server.get("slug"))
        for tool in server.get("tools") or []:
            if not isinstance(tool, dict):
                continue
            name = str(tool.get("name") or "")
            ns = _namespaced(slug, name)
            if ns in offered:
                index[ns] = (slug, name, str(tool.get("governance") or "jit"), mode_by_slug.get(slug, "proxy"))

    # Local pool only for stdio servers; http servers go through the backend proxy.
    local_servers = [
        s
        for s in servers
        if _mode_for(s) == "local" and _server_allowed_for_runtime(str(s.get("transport") or "http"), runner_runtime)
    ]
    pool = _McpConnectionPool(local_servers)
    proxy = _ProxyExecutor(backend_url=backend_url, runner_token=runner_token, agent_id=agent_id or identity.agent_id)

    # Bound the lifetime of stdio subprocesses. The runner reuses one long-lived SDK across many
    # runs and builds a fresh pool per run; register it on the SDK, close the previous run's pool,
    # and rely on QlixSDK.aclose() for the last one. (The proxy holds no persistent connections.)
    pools = getattr(qlix_sdk, "_mcp_pools", None)
    if not isinstance(pools, list):
        pools = []
        try:
            setattr(qlix_sdk, "_mcp_pools", pools)
        except Exception:
            pools = []
    for old in pools:
        try:
            old.close()
        except Exception:
            pass
    pools.clear()
    pools.append(pool)

    executors: dict[str, Any] = {}

    def _make_executor(ns_name: str, slug: str, tool: str, governance: str, mode: str):
        action_type = _scope_for(slug, tool)
        risk_level = "high" if governance == "jit" else "low"

        async def _execute(args_json: str) -> str:
            try:
                args = json.loads(args_json) if args_json and args_json.strip() else {}
            except json.JSONDecodeError:
                args = {}
            if not isinstance(args, dict):
                args = {}

            # Just-in-time approval when this tool (or its server wildcard) is a JIT scope.
            jit_token = None
            if _is_jit(identity, slug, tool):
                try:
                    approval = await qlix_sdk.jit.request_and_wait(
                        action_type=action_type, payload=args
                    )
                    jit_token = getattr(approval, "jit_token", None)
                except Exception as exc:  # noqa: BLE001
                    return f"[failed] JIT approval not granted: {exc}"

            try:
                action_id = await qlix_sdk.start_action(
                    action_type=action_type,
                    payload={"server": slug, "tool": tool, "args": args},
                    risk_level=risk_level,
                    jit_token=jit_token,
                )
            except Exception as exc:  # noqa: BLE001
                return f"[failed] action not authorized: {exc}"

            try:
                if mode == "proxy":
                    is_error, text = await proxy.call(slug, tool, args)
                else:
                    is_error, text = await pool.call(slug, tool, args)
            except Exception as exc:  # noqa: BLE001
                await qlix_sdk.complete_action_failure(
                    action_id=action_id, action_type=action_type, exc=exc
                )
                return f"[failed] MCP call error: {exc}"

            if is_error:
                await qlix_sdk.complete_action_failure(
                    action_id=action_id,
                    action_type=action_type,
                    error_message=text[:2000],
                    error_code="McpToolError",
                    result={"preview": text[:500]},
                )
                return f"[failed] {text}"

            await qlix_sdk.complete_action_success(
                action_id=action_id,
                action_type=action_type,
                result={"preview": text[:500]},
            )
            return text

        return _execute

    for ns_name, (slug, tool, governance, mode) in index.items():
        executors[ns_name] = _make_executor(ns_name, slug, tool, governance, mode)

    # The pool stays alive via the executor closures and the SDK registration above;
    # it is closed when the next run builds its pool, or in QlixSDK.aclose().
    return executors
