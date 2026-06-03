"""Structural protocols for substituting fakes in place of LunaSystem."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, List, Optional, Protocol

if TYPE_CHECKING:
    from qlix.luna.core.config import LunaConfig
    from qlix.luna.core.events import EventBus
    from qlix.luna.engine._stubs import InferenceEngine
    from qlix.luna.security.capabilities import CapabilityPolicy
    from qlix.luna.sessions.session import SessionStore
    from qlix.luna.tools._stubs import BaseTool
    from qlix.luna.tools.storage._stubs import MemoryBackend
    from qlix.luna.traces.collector import TraceCollector
    from qlix.luna.traces.store import TraceStore


class OrchestratorDeps(Protocol):
    """Minimum surface of LunaSystem that QueryOrchestrator depends on.

    Tests can satisfy this with a lightweight class — no need to construct
    the full LunaSystem dataclass or materialize every subsystem.
    """

    config: LunaConfig
    bus: EventBus
    engine: InferenceEngine
    engine_key: str
    model: str
    agent_name: str
    tools: List[BaseTool]
    memory_backend: Optional[MemoryBackend]
    capability_policy: Optional[CapabilityPolicy]
    session_store: Optional[SessionStore]
    trace_store: Optional[TraceStore]
    trace_collector: Optional[TraceCollector]  # written by _run_agent

    # Optional attribute (getattr with default) — declared for type clarity.
    _skill_few_shot_examples: Any
