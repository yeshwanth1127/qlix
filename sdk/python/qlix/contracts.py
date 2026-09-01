"""Versioned, wire-safe contracts shared by Qlix runtimes.

These types describe existing behavior. They do not select providers or alter
tool execution; adapters are introduced separately after compatibility checks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Sequence


CAPABILITY_CONTRACT_VERSION = "qlix.capability.v1"
RUNTIME_EVENT_CONTRACT_VERSION = "qlix.runtime-event.v1"
RUNNER_REQUEST_CONTRACT_VERSION = "qlix.runner-request.v1"
RUNNER_RESPONSE_CONTRACT_VERSION = "qlix.runner-response.v1"
TRACE_ENVELOPE_CONTRACT_VERSION = "qlix.trace-envelope.v1"

RuntimeKind = Literal["local", "cloud", "hybrid"]
RiskLevel = Literal["low", "moderate", "high", "critical"]
RiskEffect = Literal["read", "write", "execute", "external_communication", "financial"]
ProviderKind = Literal["builtin", "local", "backend_proxy", "connector", "mcp", "browser"]
ScopeMode = Literal["all", "any"]
RuntimeEventSource = Literal["backend", "cloud_runner", "hybrid_runner", "local_runner", "team"]
TraceExecutionKind = Literal["agent_run", "team_run", "subagent", "gateway", "brain", "conversation"]

_RUNTIMES = frozenset({"local", "cloud", "hybrid"})
_RISK_LEVELS = frozenset({"low", "moderate", "high", "critical"})
_RISK_EFFECTS = frozenset({"read", "write", "execute", "external_communication", "financial"})
_PROVIDER_KINDS = frozenset({"builtin", "local", "backend_proxy", "connector", "mcp", "browser"})
_EVENT_SOURCES = frozenset({"backend", "cloud_runner", "hybrid_runner", "local_runner", "team"})
_TRACE_EXECUTION_KINDS = frozenset({"agent_run", "team_run", "subagent", "gateway", "brain", "conversation"})

SUPPORTED_CONTRACT_VERSIONS = frozenset({
    CAPABILITY_CONTRACT_VERSION,
    RUNTIME_EVENT_CONTRACT_VERSION,
    RUNNER_REQUEST_CONTRACT_VERSION,
    RUNNER_RESPONSE_CONTRACT_VERSION,
    TRACE_ENVELOPE_CONTRACT_VERSION,
})


class ContractVersionError(ValueError):
    """Raised when a peer explicitly requests only unsupported contracts."""


def negotiate_contract_version(offered: Sequence[str] | None, supported: Sequence[str]) -> str | None:
    """Choose the first mutually supported version; no offer means legacy mode."""
    if offered is None:
        return None
    supported_set = set(supported)
    for version in offered:
        if version in supported_set:
            return version
    raise ContractVersionError(
        f"No compatible contract version; offered={list(offered)!r}, supported={list(supported)!r}"
    )


def _unique_strings(values: Sequence[str], field_name: str, *, allow_empty: bool = True) -> tuple[str, ...]:
    result = tuple(values)
    if not allow_empty and not result:
        raise ValueError(f"{field_name} must not be empty")
    if any(not isinstance(value, str) or not value for value in result):
        raise ValueError(f"{field_name} must contain non-empty strings")
    if len(set(result)) != len(result):
        raise ValueError(f"{field_name} must not contain duplicates")
    return result


@dataclass(frozen=True, slots=True)
class CapabilityJit:
    required: bool = False
    scopes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "scopes", _unique_strings(self.scopes, "jit.scopes"))


@dataclass(frozen=True, slots=True)
class CapabilityRisk:
    level: RiskLevel = "low"
    effects: tuple[RiskEffect, ...] = ()

    def __post_init__(self) -> None:
        if self.level not in _RISK_LEVELS:
            raise ValueError(f"Unsupported capability risk level: {self.level}")
        effects = _unique_strings(self.effects, "risk.effects")
        unsupported = set(effects) - _RISK_EFFECTS
        if unsupported:
            raise ValueError(f"Unsupported capability risk effects: {sorted(unsupported)}")
        object.__setattr__(self, "effects", effects)


@dataclass(frozen=True, slots=True)
class CapabilityProvider:
    kind: ProviderKind
    id: str

    def __post_init__(self) -> None:
        if self.kind not in _PROVIDER_KINDS:
            raise ValueError(f"Unsupported capability provider kind: {self.kind}")
        if not self.id:
            raise ValueError("provider.id must not be empty")


@dataclass(frozen=True, slots=True)
class CapabilityDescriptor:
    name: str
    description: str
    input_schema: Mapping[str, Any]
    required_scopes: tuple[str, ...]
    scope_mode: ScopeMode
    jit: CapabilityJit
    runtimes: tuple[RuntimeKind, ...]
    risk: CapabilityRisk
    provider: CapabilityProvider
    aliases: tuple[str, ...] = field(default_factory=tuple)
    contract_version: str = CAPABILITY_CONTRACT_VERSION

    def __post_init__(self) -> None:
        if self.contract_version != CAPABILITY_CONTRACT_VERSION:
            raise ValueError(f"Unsupported capability contract version: {self.contract_version}")
        if not self.name:
            raise ValueError("name must not be empty")
        if not isinstance(self.input_schema, Mapping):
            raise ValueError("input_schema must be an object")
        object.__setattr__(self, "required_scopes", _unique_strings(self.required_scopes, "required_scopes"))
        if self.scope_mode not in {"all", "any"}:
            raise ValueError(f"Unsupported capability scope mode: {self.scope_mode}")
        runtimes = _unique_strings(self.runtimes, "runtimes", allow_empty=False)
        unsupported = set(runtimes) - _RUNTIMES
        if unsupported:
            raise ValueError(f"Unsupported capability runtimes: {sorted(unsupported)}")
        object.__setattr__(self, "runtimes", runtimes)
        object.__setattr__(self, "aliases", _unique_strings(self.aliases, "aliases"))

    def to_wire(self) -> dict[str, Any]:
        return {
            "contractVersion": self.contract_version,
            "name": self.name,
            "description": self.description,
            "inputSchema": dict(self.input_schema),
            "requiredScopes": list(self.required_scopes),
            "scopeMode": self.scope_mode,
            "jit": {"required": self.jit.required, "scopes": list(self.jit.scopes)},
            "runtimes": list(self.runtimes),
            "risk": {"level": self.risk.level, "effects": list(self.risk.effects)},
            "provider": {"kind": self.provider.kind, "id": self.provider.id},
            "aliases": list(self.aliases),
        }

    @classmethod
    def from_wire(cls, value: Mapping[str, Any]) -> "CapabilityDescriptor":
        return cls(
            contract_version=value.get("contractVersion", ""),
            name=value.get("name", ""),
            description=value.get("description", ""),
            input_schema=value.get("inputSchema", {}),
            required_scopes=tuple(value.get("requiredScopes", ())),
            scope_mode=value.get("scopeMode", ""),
            jit=CapabilityJit(**value.get("jit", {})),
            runtimes=tuple(value.get("runtimes", ())),
            risk=CapabilityRisk(**value.get("risk", {})),
            provider=CapabilityProvider(**value.get("provider", {})),
            aliases=tuple(value.get("aliases", ())),
        )


@dataclass(frozen=True, slots=True)
class RuntimeEventLinks:
    parent_run_id: str | None = None
    tool_call_id: str | None = None
    team_run_id: str | None = None
    subtask_id: str | None = None

    def __post_init__(self) -> None:
        for field_name in ("parent_run_id", "tool_call_id", "team_run_id", "subtask_id"):
            value = getattr(self, field_name)
            if value is not None and not value:
                raise ValueError(f"links.{field_name} must not be empty")

    def to_wire(self) -> dict[str, str]:
        names = {
            "parent_run_id": "parentRunId",
            "tool_call_id": "toolCallId",
            "team_run_id": "teamRunId",
            "subtask_id": "subtaskId",
        }
        return {wire: value for local, wire in names.items() if (value := getattr(self, local)) is not None}

    @classmethod
    def from_wire(cls, value: Mapping[str, Any]) -> "RuntimeEventLinks":
        return cls(
            parent_run_id=value.get("parentRunId"),
            tool_call_id=value.get("toolCallId"),
            team_run_id=value.get("teamRunId"),
            subtask_id=value.get("subtaskId"),
        )


@dataclass(frozen=True, slots=True)
class RuntimeEventEnvelope:
    event_id: str
    run_id: str
    sequence: int
    occurred_at: str
    source: RuntimeEventSource
    type: str
    data: Any
    links: RuntimeEventLinks | None = None
    contract_version: str = RUNTIME_EVENT_CONTRACT_VERSION

    def __post_init__(self) -> None:
        if self.contract_version != RUNTIME_EVENT_CONTRACT_VERSION:
            raise ValueError(f"Unsupported runtime event contract version: {self.contract_version}")
        for field_name in ("event_id", "run_id", "occurred_at", "type"):
            if not getattr(self, field_name):
                raise ValueError(f"{field_name} must not be empty")
        if isinstance(self.sequence, bool) or not isinstance(self.sequence, int) or self.sequence < 0:
            raise ValueError("sequence must be a non-negative integer")
        if self.source not in _EVENT_SOURCES:
            raise ValueError(f"Unsupported runtime event source: {self.source}")

    def to_wire(self) -> dict[str, Any]:
        result = {
            "contractVersion": self.contract_version,
            "eventId": self.event_id,
            "runId": self.run_id,
            "sequence": self.sequence,
            "occurredAt": self.occurred_at,
            "source": self.source,
            "type": self.type,
            "data": self.data,
        }
        if self.links is not None:
            result["links"] = self.links.to_wire()
        return result

    @classmethod
    def from_wire(cls, value: Mapping[str, Any]) -> "RuntimeEventEnvelope":
        raw_links = value.get("links")
        return cls(
            contract_version=value.get("contractVersion", ""),
            event_id=value.get("eventId", ""),
            run_id=value.get("runId", ""),
            sequence=value.get("sequence", -1),
            occurred_at=value.get("occurredAt", ""),
            source=value.get("source", ""),
            type=value.get("type", ""),
            data=value.get("data"),
            links=RuntimeEventLinks.from_wire(raw_links) if isinstance(raw_links, Mapping) else None,
        )


@dataclass(frozen=True, slots=True)
class RunnerRequest:
    run_id: str
    agent_id: str
    runtime: RuntimeKind
    payload: Mapping[str, Any]
    contract_version: str = RUNNER_REQUEST_CONTRACT_VERSION

    def __post_init__(self) -> None:
        if self.contract_version != RUNNER_REQUEST_CONTRACT_VERSION:
            raise ValueError(f"Unsupported runner request contract version: {self.contract_version}")
        if not self.run_id or not self.agent_id:
            raise ValueError("run_id and agent_id must not be empty")
        if self.runtime not in _RUNTIMES:
            raise ValueError(f"Unsupported runner runtime: {self.runtime}")
        if not isinstance(self.payload, Mapping):
            raise ValueError("payload must be an object")

    def to_wire(self) -> dict[str, Any]:
        return {"contractVersion": self.contract_version, "runId": self.run_id, "agentId": self.agent_id, "runtime": self.runtime, "payload": dict(self.payload)}

    @classmethod
    def from_wire(cls, value: Mapping[str, Any]) -> "RunnerRequest":
        return cls(contract_version=value.get("contractVersion", ""), run_id=value.get("runId", ""), agent_id=value.get("agentId", ""), runtime=value.get("runtime", ""), payload=value.get("payload", {}))


@dataclass(frozen=True, slots=True)
class RunnerResponse:
    run_id: str
    ok: bool
    result: Any = None
    error_message: str | None = None
    contract_version: str = RUNNER_RESPONSE_CONTRACT_VERSION
    result_present: bool = field(default=False, compare=False, repr=False)

    def __post_init__(self) -> None:
        if self.contract_version != RUNNER_RESPONSE_CONTRACT_VERSION:
            raise ValueError(f"Unsupported runner response contract version: {self.contract_version}")
        if not self.run_id:
            raise ValueError("run_id must not be empty")
        if not isinstance(self.ok, bool):
            raise ValueError("ok must be a boolean")
        if self.result is not None:
            object.__setattr__(self, "result_present", True)

    def to_wire(self) -> dict[str, Any]:
        result = {"contractVersion": self.contract_version, "runId": self.run_id, "ok": self.ok}
        if self.result_present:
            result["result"] = self.result
        if self.error_message is not None:
            result["errorMessage"] = self.error_message
        return result

    @classmethod
    def from_wire(cls, value: Mapping[str, Any]) -> "RunnerResponse":
        return cls(contract_version=value.get("contractVersion", ""), run_id=value.get("runId", ""), ok=value.get("ok"), result=value.get("result"), error_message=value.get("errorMessage"), result_present="result" in value)


def wrap_legacy_runner_request(*, agent_id: str, runtime: RuntimeKind, payload: Mapping[str, Any]) -> RunnerRequest:
    """Wrap the existing poll payload without renaming or removing any field."""
    run_id = payload.get("id")
    if not isinstance(run_id, str) or not run_id:
        raise ValueError("legacy runner request payload.id must not be empty")
    return RunnerRequest(run_id=run_id, agent_id=agent_id, runtime=runtime, payload=payload)


def unwrap_runner_request(request: RunnerRequest) -> dict[str, Any]:
    """Return the exact legacy run object expected by current runners."""
    return dict(request.payload)


def wrap_legacy_runner_response(*, run_id: str, payload: Mapping[str, Any]) -> RunnerResponse:
    """Wrap the existing completion body without changing its result value."""
    return RunnerResponse(run_id=run_id, ok=payload.get("ok"), result=payload.get("result"), error_message=payload.get("errorMessage"), result_present="result" in payload)


def unwrap_runner_response(response: RunnerResponse) -> dict[str, Any]:
    """Return the existing completion body accepted by the backend."""
    wire = response.to_wire()
    return {key: value for key, value in wire.items() if key not in {"contractVersion", "runId"}}


@dataclass(frozen=True, slots=True)
class TraceEnvelope:
    trace_id: str
    span_id: str
    execution_id: str
    execution_kind: TraceExecutionKind
    parent_span_id: str | None = None
    org_id: str | None = None
    agent_id: str | None = None
    round_id: str | None = None
    attempt: int | None = None
    tool_call_id: str | None = None
    node_id: str | None = None
    contract_version: str = TRACE_ENVELOPE_CONTRACT_VERSION

    def __post_init__(self) -> None:
        if self.contract_version != TRACE_ENVELOPE_CONTRACT_VERSION:
            raise ValueError(f"Unsupported trace envelope contract version: {self.contract_version}")
        for field_name in ("trace_id", "span_id", "execution_id"):
            if not getattr(self, field_name):
                raise ValueError(f"{field_name} must not be empty")
        if self.execution_kind not in _TRACE_EXECUTION_KINDS:
            raise ValueError(f"Unsupported trace execution kind: {self.execution_kind}")
        if self.attempt is not None and (isinstance(self.attempt, bool) or self.attempt < 0):
            raise ValueError("attempt must be a non-negative integer")

    def to_wire(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "contractVersion": self.contract_version,
            "traceId": self.trace_id,
            "spanId": self.span_id,
            "executionId": self.execution_id,
            "executionKind": self.execution_kind,
        }
        if self.parent_span_id is not None:
            result["parentSpanId"] = self.parent_span_id
        if self.org_id is not None:
            result["orgId"] = self.org_id
        if self.agent_id is not None:
            result["agentId"] = self.agent_id
        if self.round_id is not None:
            result["roundId"] = self.round_id
        if self.attempt is not None:
            result["attempt"] = self.attempt
        if self.tool_call_id is not None:
            result["toolCallId"] = self.tool_call_id
        if self.node_id is not None:
            result["nodeId"] = self.node_id
        return result

    @classmethod
    def from_wire(cls, value: Mapping[str, Any]) -> "TraceEnvelope":
        return cls(
            contract_version=value.get("contractVersion", ""),
            trace_id=value.get("traceId", ""),
            span_id=value.get("spanId", ""),
            parent_span_id=value.get("parentSpanId"),
            execution_id=value.get("executionId", ""),
            execution_kind=value.get("executionKind", ""),
            org_id=value.get("orgId"),
            agent_id=value.get("agentId"),
            round_id=value.get("roundId"),
            attempt=value.get("attempt"),
            tool_call_id=value.get("toolCallId"),
            node_id=value.get("nodeId"),
        )


def attach_trace(data: Mapping[str, Any], envelope: TraceEnvelope) -> dict[str, Any]:
    """Stamp a trace envelope onto a runner event without overwriting an existing one."""
    if isinstance(data.get("trace"), Mapping):
        return dict(data)
    return {**data, "trace": envelope.to_wire()}


__all__ = [
    "CAPABILITY_CONTRACT_VERSION",
    "RUNTIME_EVENT_CONTRACT_VERSION",
    "RUNNER_REQUEST_CONTRACT_VERSION",
    "RUNNER_RESPONSE_CONTRACT_VERSION",
    "TRACE_ENVELOPE_CONTRACT_VERSION",
    "SUPPORTED_CONTRACT_VERSIONS",
    "CapabilityDescriptor",
    "CapabilityJit",
    "CapabilityProvider",
    "CapabilityRisk",
    "ContractVersionError",
    "ProviderKind",
    "RiskEffect",
    "RiskLevel",
    "RunnerRequest",
    "RunnerResponse",
    "RuntimeEventEnvelope",
    "RuntimeEventLinks",
    "RuntimeEventSource",
    "RuntimeKind",
    "ScopeMode",
    "TraceEnvelope",
    "TraceExecutionKind",
    "attach_trace",
    "negotiate_contract_version",
    "unwrap_runner_request",
    "unwrap_runner_response",
    "wrap_legacy_runner_request",
    "wrap_legacy_runner_response",
]
