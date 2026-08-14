"""Luna-Teams ADK — team coordination contracts, sibling to ``qlix.luna``.

This package is the single ADK folder for teams, the same way ``qlix.luna``
is the single ADK folder for individual agents.

Importing it does not register tools with Luna or alter an agent runner.
The backend team host owns execution of these contracts.
"""

from .core import (
    DispatchContract,
    DispatchRequest,
    InputPurpose,
    KnowledgeMode,
    MailboxEnvelope,
    MailboxKind,
    MailboxStatus,
    ResultEnvelope,
    ResultProvenance,
    TeamMember,
    WaitRequest,
    as_payload,
    commander_tool_definitions,
)

__all__ = [
    "DispatchContract",
    "DispatchRequest",
    "InputPurpose",
    "KnowledgeMode",
    "MailboxEnvelope",
    "MailboxKind",
    "MailboxStatus",
    "ResultEnvelope",
    "ResultProvenance",
    "TeamMember",
    "WaitRequest",
    "as_payload",
    "commander_tool_definitions",
]
