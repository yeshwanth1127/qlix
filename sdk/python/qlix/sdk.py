"""QlixSDK — the only module Luna tools talk to.

Lifecycle of a single tool invocation, wrapped by qlix.run():

    1. Resolve scope class:
         a. JIT scope     → request user approval, block until approved/denied.
         b. Always scope  → fall through to step 2.
         c. Unknown scope → raise ScopeError immediately, do NOT call execute_fn.
    2. POST /api/v1/actions/start  with signed payload → receive action_id.
    3. Run execute_fn() — capture result OR exception.
    4. POST /api/v1/actions/complete with success/result OR success=false/error.
       Backend debits the wallet on success only.
    5. Return the original result, or re-raise the original exception.
"""

from __future__ import annotations

import os
import time
import traceback
from typing import Any, Awaitable, Callable, Optional

from .dev import is_dev_mode
from .exceptions import HttpError, ScopeError
from .http_client import QlixHttpClient
from .identity import AgentIdentity, load_identity
from .jit import JITApproval, JITClient
from .signer import sign_payload

ExecuteFn = Callable[[], Awaitable[Any]]
RiskLevel = str  # "low" | "medium" | "high"

# Placeholder identity used when QLIX_DEV=1 and no credentials are provided.
# Syntactically valid hex keys, but never sent to the backend in dev mode.
_DEV_IDENTITY = AgentIdentity(
    did="did:qlix:dev",
    agent_id="dev",
    private_key_hex="0" * 64,
    public_key_hex="0" * 64,
    permission_scopes=("*",),
    jit_scopes=(),
    always_scopes=("*",),
    backend_url="http://localhost:8080",
    llm_mode="direct",
    raw={},
)


class QlixSDK:
    """Holds identity + signer + http client. Construct once per process."""

    def __init__(
        self,
        *,
        identity: AgentIdentity | None = None,
        http: QlixHttpClient | None = None,
        agent_file: str | os.PathLike[str] | None = None,
    ) -> None:
        if identity is not None:
            ident = identity
        elif is_dev_mode() and agent_file is None and not os.environ.get("QLIX_AGENT_FILE"):
            # Dev mode with no credentials supplied — use a no-op placeholder.
            # All tool calls are short-circuited before they reach the SDK,
            # so the identity and http client here are never exercised.
            ident = _DEV_IDENTITY
        else:
            ident = load_identity(agent_file)
        self._bind_identity(ident, http=http)
        from qlix.luna._gate import set_active_sdk

        set_active_sdk(self)

    @property
    def identity(self) -> AgentIdentity:
        return self._identity

    @property
    def jit(self) -> JITClient:
        return self._jit

    async def aclose(self) -> None:
        from qlix.luna._gate import clear_active_sdk

        await self._http.aclose()
        clear_active_sdk()

    async def __aenter__(self) -> "QlixSDK":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    def reload_credentials(self, *, agent_file: str | os.PathLike[str] | None = None) -> None:
        """Re-load identity from ``agent_file`` or from ``QLIX_AGENT_FILE``."""
        self._bind_identity(load_identity(agent_file))

    def _bind_identity(
        self,
        identity: AgentIdentity,
        *,
        http: QlixHttpClient | None = None,
    ) -> None:
        self._identity = identity
        self._http = http or QlixHttpClient(base_url=identity.backend_url)
        self._jit = JITClient(
            http=self._http,
            did=identity.did,
            private_key_hex=identity.private_key_hex,
        )

    async def start(
        self,
        *,
        config_path: str | os.PathLike[str] | None = None,
    ) -> Any:
        """Boot Luna using credentials from ``QLIX_AGENT_FILE`` / ``agent_file``.

        Builds a :class:`LunaSystem` from the default or given Luna config,
        then wraps the runtime :class:`~qlix.luna.tools._stubs.ToolExecutor`
        with :class:`~qlix.luna_bridge.QlixToolExecutor`.

        Engine selection is driven by ``llm_mode`` from the agent identity:
        - ``"proxy"`` → forces the ``cloud`` engine (LLM calls routed via Qlix backend).
        - ``"direct"`` → uses whatever engine the Luna config specifies (local Ollama, etc.).
        """
        from qlix.luna.system.builder import SystemBuilder

        from .luna_bridge import wrap_tool_executor_with_qlix

        builder = (
            SystemBuilder(config_path=config_path)
            if config_path is not None
            else SystemBuilder()
        )
        if self._identity.llm_mode == "proxy":
            builder = builder.engine("cloud")
        system = builder.build()
        wrap_tool_executor_with_qlix(system, self)
        return system

    async def run(
        self,
        action_type: str,
        payload: dict[str, Any],
        execute_fn: ExecuteFn,
        *,
        risk_level: RiskLevel = "low",
    ) -> Any:
        identity = self._identity

        if not identity.has_scope(action_type):
            raise ScopeError(
                f"action_type '{action_type}' is not in agent permission_scopes"
            )

        approval: Optional[JITApproval] = None
        if identity.is_jit(action_type):
            approval = await self._jit.request_and_wait(
                action_type=action_type, payload=payload
            )

        action_id = await self.start_action(
            action_type=action_type,
            payload=payload,
            risk_level=risk_level,
            jit_token=approval.jit_token if approval else None,
        )

        try:
            result = await execute_fn()
        except Exception as exc:
            await self.complete_action_failure(
                action_id=action_id,
                action_type=action_type,
                exc=exc,
            )
            raise
        else:
            await self.complete_action_success(
                action_id=action_id,
                action_type=action_type,
                result=result,
            )
            return result

    async def start_action(
        self,
        *,
        action_type: str,
        payload: dict[str, Any],
        risk_level: RiskLevel,
        jit_token: str | None,
    ) -> str:
        signed: dict[str, Any] = {
            "did": self._identity.did,
            "actionType": action_type,
            "timestampMs": _now_ms(),
            "riskLevel": risk_level,
            "metadata": payload,
        }
        if jit_token is not None:
            signed["jitToken"] = jit_token

        signature = sign_payload(signed, private_key_hex=self._identity.private_key_hex)
        body = {"signature": signature, "signedPayload": signed}
        response = await self._http.post_json("/api/v1/actions/start", body)
        action_id = response.get("actionId")
        if not isinstance(action_id, str) or not action_id:
            raise HttpError(
                "actions/start did not return an actionId",
                status_code=200,
                body=response,
            )
        return action_id

    async def complete_action_success(
        self,
        *,
        action_id: str,
        action_type: str,
        result: Any,
    ) -> None:
        signed: dict[str, Any] = {
            "did": self._identity.did,
            "actionId": action_id,
            "success": True,
            "timestampMs": _now_ms(),
            "eventType": action_type,
            "eventKey": action_id,
            "result": _normalize_result(result),
        }
        await self._post_complete(signed)

    async def complete_action_failure(
        self,
        *,
        action_id: str,
        action_type: str,
        exc: BaseException | None = None,
        error_message: str | None = None,
        error_code: str | None = None,
        result: Any = None,
    ) -> None:
        signed: dict[str, Any] = {
            "did": self._identity.did,
            "actionId": action_id,
            "success": False,
            "timestampMs": _now_ms(),
            "eventType": action_type,
            "errorMessage": _truncate(
                error_message or (str(exc) if exc is not None else "unknown failure"),
                4_000,
            ),
            "errorCode": error_code
            or (exc.__class__.__name__ if exc is not None else "FailureReported"),
        }
        if result is not None:
            signed["result"] = _normalize_result(result)
        try:
            await self._post_complete(signed)
        except Exception:
            # Never let audit-tail failure mask the original exception.
            traceback.print_exc()

    async def _post_complete(self, signed: dict[str, Any]) -> None:
        signature = sign_payload(signed, private_key_hex=self._identity.private_key_hex)
        body = {"signature": signature, "signedPayload": signed}
        await self._http.post_json("/api/v1/actions/complete", body)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize_result(result: Any) -> dict[str, Any]:
    """Coerce arbitrary tool return values into a JSON-safe object."""
    if result is None:
        return {}
    if isinstance(result, dict):
        return _ensure_json_safe(result)
    return {"value": _ensure_json_safe(result)}


def _ensure_json_safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _ensure_json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_ensure_json_safe(v) for v in value]
    return repr(value)


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "...(truncated)"
