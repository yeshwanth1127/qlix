"""Bundle dataclasses that group cohesive subsystems of LunaSystem."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from qlix.luna.agents._stubs import BaseAgent
    from qlix.luna.agents.executor import AgentExecutor
    from qlix.luna.agents.manager import AgentManager
    from qlix.luna.agents.scheduler import AgentScheduler
    from qlix.luna.scheduler.scheduler import TaskScheduler
    from qlix.luna.scheduler.store import SchedulerStore
    from qlix.luna.security.audit import AuditLogger
    from qlix.luna.security.boundary import BoundaryGuard
    from qlix.luna.security.capabilities import CapabilityPolicy
    from qlix.luna.telemetry.gpu_monitor import GpuMonitor
    from qlix.luna.telemetry.store import TelemetryStore
    from qlix.luna.traces.collector import TraceCollector
    from qlix.luna.traces.store import TraceStore


@dataclass
class SecurityContext:
    """Security policy, audit, and boundary enforcement."""

    capability_policy: Optional[CapabilityPolicy] = None
    audit_logger: Optional[AuditLogger] = None
    boundary_guard: Optional[BoundaryGuard] = None


@dataclass
class Observability:
    """Telemetry, traces, and hardware monitoring."""

    telemetry_store: Optional[TelemetryStore] = None
    trace_store: Optional[TraceStore] = None
    trace_collector: Optional[TraceCollector] = None
    gpu_monitor: Optional[GpuMonitor] = None


@dataclass
class AgentRuntime:
    """Active agent and agent lifecycle managers."""

    agent: Optional[BaseAgent] = None
    agent_name: str = ""
    manager: Optional[AgentManager] = None
    scheduler: Optional[AgentScheduler] = None
    executor: Optional[AgentExecutor] = None


@dataclass
class Scheduling:
    """Task scheduler and its persistent store."""

    store: Optional[SchedulerStore] = None
    runner: Optional[TaskScheduler] = None
