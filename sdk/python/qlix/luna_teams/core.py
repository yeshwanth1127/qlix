"""Luna-Teams ADK contracts.

This module is the team control plane.  It is intentionally independent
from ``qlix.luna`` and from every individual-agent runner.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Mapping, Sequence

JsonSchema = Mapping[str, Any]


class MailboxKind(str, Enum):
    MESSAGE = "message"
    RESULT = "result"


class MailboxStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


class InputPurpose(str, Enum):
    AUTHORITATIVE_INPUT = "authoritative_input"
    REFERENCE_ASSET = "reference_asset"


class KnowledgeMode(str, Enum):
    NONE = "none"
    REFERENCE_ONLY = "reference_only"
    REQUIRED = "required"


@dataclass(frozen=True)
class TeamMember:
    agent_id: str
    name: str
    role: str
    delegated_scopes: tuple[str, ...] = ()


@dataclass(frozen=True)
class DispatchContract:
    """Optional validation contract applied by the team bus after completion."""

    contract_id: str
    schema: JsonSchema


@dataclass(frozen=True)
class DispatchRequest:
    to: str
    task: str
    contract_id: str | None = None
    input_refs: tuple[str, ...] = ()
    allowed_sources: tuple[InputPurpose, ...] = (InputPurpose.AUTHORITATIVE_INPUT,)
    allowed_scopes: tuple[str, ...] = ()
    knowledge_mode: KnowledgeMode = KnowledgeMode.NONE
    output_contract: JsonSchema = field(default_factory=dict)


@dataclass(frozen=True)
class WaitRequest:
    kind: str
    params: Mapping[str, Any] = field(default_factory=dict)
    side_effects: tuple[Mapping[str, Any], ...] = ()


@dataclass(frozen=True)
class MailboxEnvelope:
    message_id: str
    kind: MailboxKind
    status: MailboxStatus
    sender_agent_id: str | None
    recipient_agent_id: str | None
    payload: Any
    contract_id: str | None = None


@dataclass(frozen=True)
class ResultProvenance:
    input_refs: tuple[str, ...] = ()
    record_refs: tuple[str, ...] = ()
    knowledge_refs: tuple[str, ...] = ()


@dataclass(frozen=True)
class ResultEnvelope:
    data: Any
    provenance: ResultProvenance


def commander_tool_definitions(roster: Sequence[TeamMember]) -> list[dict[str, Any]]:
    """Return provider-neutral OpenAI tool schemas for a team commander host."""

    names = [member.name for member in roster]
    roster_hint = ", ".join(names) if names else "No members are available"
    return [
        {
            "type": "function",
            "function": {
                "name": "dispatch_to",
                "description": (
                    "Give one existing team member a short, self-contained task. "
                    f"Available members: {roster_hint}."
                ),
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "to": {"type": "string", "enum": names},
                        "task": {"type": "string", "minLength": 1},
                        "contract_id": {"type": "string"},
                        "input_refs": {"type": "array", "items": {"type": "string"}},
                        "allowed_sources": {
                            "type": "array",
                            "items": {"enum": [purpose.value for purpose in InputPurpose]},
                        },
                        "allowed_scopes": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Subset of the member's delegated scopes for this task. "
                                "Empty means no connector tools."
                            ),
                        },
                        "knowledge_mode": {
                            "enum": [mode.value for mode in KnowledgeMode],
                        },
                        "output_contract": {"type": "object"},
                    },
                    "required": ["to", "task"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "wait_result",
                "description": "Read a dispatched member's durable Result envelope.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"message_id": {"type": "string"}},
                    "required": ["message_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "interrupt_member",
                "description": "Cancel an in-flight task owned by a team member.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"to": {"type": "string", "enum": names}},
                    "required": ["to"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "request_wait",
                "description": (
                    "Pause the team on an external trigger. Trigger kinds and side "
                    "effects are supplied by backend adapters, not by individual agents."
                ),
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "kind": {"type": "string", "minLength": 1},
                        "params": {"type": "object"},
                        "side_effects": {
                            "type": "array",
                            "items": {"type": "object"},
                        },
                    },
                    "required": ["kind"],
                },
            },
        },
    ]


def as_payload(value: Any) -> dict[str, Any]:
    if not hasattr(value, "__dataclass_fields__"):
        raise TypeError("Luna-Teams payloads must be dataclass instances")
    return asdict(value)
