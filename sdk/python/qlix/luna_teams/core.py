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


class IntentMode(str, Enum):
    NEW = "new"
    REPEAT = "repeat"
    MODIFY = "modify"
    CONTINUE = "continue"
    QUESTION = "question"
    CANCEL = "cancel"
    CLARIFICATION_REQUIRED = "clarification_required"


@dataclass(frozen=True)
class IntentRequirement:
    id: str
    text: str
    source: str = "original"


@dataclass(frozen=True)
class IntentPatch:
    operation: str
    requirement_id: str | None = None
    text: str | None = None


@dataclass(frozen=True)
class ResolvedIntent:
    """Versioned execution intent shared by every Luna-Teams host."""

    effective_goal: str
    requirements: tuple[IntentRequirement, ...]
    user_message: str
    mode: IntentMode = IntentMode.NEW
    base_run_id: str | None = None
    changes: tuple[IntentPatch, ...] = ()
    confidence: float = 1.0
    clarification_question: str | None = None
    version: int = 1


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
    requirement_ids: tuple[str, ...] = ()


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
                        "requirement_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Stable active-intent requirements owned by this dispatch.",
                        },
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


def repeat_intent(base: ResolvedIntent, user_message: str, base_run_id: str) -> ResolvedIntent:
    """Create an immutable repeat snapshot without asking a model to reconstruct it."""

    return ResolvedIntent(
        effective_goal=base.effective_goal,
        requirements=tuple(base.requirements),
        user_message=user_message,
        mode=IntentMode.REPEAT,
        base_run_id=base_run_id,
        confidence=1.0,
    )


def apply_intent_patches(
    base: ResolvedIntent,
    patches: Sequence[IntentPatch],
    user_message: str,
    base_run_id: str,
) -> ResolvedIntent:
    """Apply explicit add/remove/replace operations; unrelated requirements survive."""

    requirements = list(base.requirements)
    for patch in patches:
        if patch.operation == "add":
            if not patch.text or not patch.text.strip():
                raise ValueError("add intent patch requires text")
            requirement_id = patch.requirement_id or f"req_{len(requirements) + 1}"
            if any(item.id == requirement_id for item in requirements):
                raise ValueError(f"duplicate intent requirement id: {requirement_id}")
            requirements.append(IntentRequirement(requirement_id, patch.text.strip(), "follow_up"))
            continue
        if patch.operation not in {"remove", "replace"}:
            raise ValueError(f"unsupported intent patch operation: {patch.operation}")
        index = next(
            (i for i, item in enumerate(requirements) if item.id == patch.requirement_id),
            None,
        )
        if index is None:
            raise ValueError(f"unknown intent requirement id: {patch.requirement_id}")
        if patch.operation == "remove":
            requirements.pop(index)
        else:
            if not patch.text or not patch.text.strip():
                raise ValueError("replace intent patch requires text")
            current = requirements[index]
            requirements[index] = IntentRequirement(current.id, patch.text.strip(), "follow_up")
    if not requirements:
        raise ValueError("intent patches cannot remove the entire workflow")
    effective_goal = ". Then ".join(item.text.rstrip(".") for item in requirements)
    return ResolvedIntent(
        effective_goal=effective_goal,
        requirements=tuple(requirements),
        user_message=user_message,
        mode=IntentMode.MODIFY,
        base_run_id=base_run_id,
        changes=tuple(patches),
        confidence=1.0,
    )


def missing_requirement_ids(
    intent: ResolvedIntent,
    dispatches: Sequence[DispatchRequest],
) -> tuple[str, ...]:
    """Return active requirements not claimed by any proposed dispatch."""

    claimed = {requirement_id for dispatch in dispatches for requirement_id in dispatch.requirement_ids}
    return tuple(item.id for item in intent.requirements if item.id not in claimed)
