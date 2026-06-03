"""LunaSystem — the fully wired system dataclass."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from qlix.luna.core.config import LunaConfig
from qlix.luna.core.events import EventBus
from qlix.luna.core.types import Message, Role
from qlix.luna.engine._stubs import InferenceEngine
from qlix.luna.system.bundles import (
    AgentRuntime,
    Observability,
    Scheduling,
    SecurityContext,
)
from qlix.luna.tools._stubs import BaseTool, ToolExecutor

if TYPE_CHECKING:
    from qlix.luna.agents._stubs import BaseAgent
    from qlix.luna.agents.executor import AgentExecutor
    from qlix.luna.agents.manager import AgentManager
    from qlix.luna.agents.scheduler import AgentScheduler
    from qlix.luna.mcp.client import MCPClient
    from qlix.luna.mcp.server import MCPServer
    from qlix.luna.operators.manager import OperatorManager
    from qlix.luna.sandbox.runner import ContainerRunner
    from qlix.luna.scheduler.scheduler import TaskScheduler
    from qlix.luna.scheduler.store import SchedulerStore
    from qlix.luna.security.audit import AuditLogger
    from qlix.luna.security.boundary import BoundaryGuard
    from qlix.luna.security.capabilities import CapabilityPolicy
    from qlix.luna.sessions.session import SessionStore
    from qlix.luna.skills.manager import SkillManager
    from qlix.luna.system.orchestrator import QueryOrchestrator
    from qlix.luna.telemetry.gpu_monitor import GpuMonitor
    from qlix.luna.telemetry.store import TelemetryStore
    from qlix.luna.tools.storage._stubs import MemoryBackend
    from qlix.luna.traces.collector import TraceCollector
    from qlix.luna.traces.store import TraceStore
    from qlix.luna.workflow.engine import WorkflowEngine

logger = logging.getLogger(__name__)


@dataclass
class LunaSystem:
    """Fully wired system -- the single source of truth for primitive composition."""

    config: LunaConfig
    bus: EventBus
    engine: InferenceEngine
    engine_key: str
    model: str
    agent: Optional[BaseAgent] = None
    agent_name: str = ""
    tools: List[BaseTool] = field(default_factory=list)
    tool_executor: Optional[ToolExecutor] = None
    memory_backend: Optional[MemoryBackend] = None
    channel_backend: Optional[Any] = None
    router: Optional[Any] = None
    mcp_server: Optional[MCPServer] = None
    telemetry_store: Optional[TelemetryStore] = None
    trace_store: Optional[TraceStore] = None
    trace_collector: Optional[TraceCollector] = None
    gpu_monitor: Optional[GpuMonitor] = None
    scheduler_store: Optional[SchedulerStore] = None
    scheduler: Optional[TaskScheduler] = None
    container_runner: Optional[ContainerRunner] = None
    workflow_engine: Optional[WorkflowEngine] = None
    session_store: Optional[SessionStore] = None
    capability_policy: Optional[CapabilityPolicy] = None
    audit_logger: Optional[AuditLogger] = None
    boundary_guard: Optional[BoundaryGuard] = None
    operator_manager: Optional[OperatorManager] = None
    agent_manager: Optional[AgentManager] = None
    agent_scheduler: Optional[AgentScheduler] = None
    agent_executor: Optional[AgentExecutor] = None
    speech_backend: Optional[Any] = None
    skill_manager: Optional[SkillManager] = None
    _learning_orchestrator: Optional[Any] = None
    _mcp_clients: List[MCPClient] = field(default_factory=list)

    @property
    def security(self) -> SecurityContext:
        return SecurityContext(
            capability_policy=self.capability_policy,
            audit_logger=self.audit_logger,
            boundary_guard=self.boundary_guard,
        )

    @property
    def observability(self) -> Observability:
        return Observability(
            telemetry_store=self.telemetry_store,
            trace_store=self.trace_store,
            trace_collector=self.trace_collector,
            gpu_monitor=self.gpu_monitor,
        )

    @property
    def agents(self) -> AgentRuntime:
        return AgentRuntime(
            agent=self.agent,
            agent_name=self.agent_name,
            manager=self.agent_manager,
            scheduler=self.agent_scheduler,
            executor=self.agent_executor,
        )

    @property
    def scheduling(self) -> Scheduling:
        return Scheduling(
            store=self.scheduler_store,
            runner=self.scheduler,
        )

    def _get_orchestrator(self) -> QueryOrchestrator:
        orch = self.__dict__.get("_orchestrator")
        if orch is None:
            from qlix.luna.system.orchestrator import QueryOrchestrator

            orch = QueryOrchestrator(self)
            self.__dict__["_orchestrator"] = orch
        return orch

    def ask(
        self,
        query: str,
        *,
        context: bool = True,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        agent: Optional[str] = None,
        tools: Optional[List[str]] = None,
        system_prompt: Optional[str] = None,
        operator_id: Optional[str] = None,
        prior_messages: Optional[List[Message]] = None,
    ) -> Dict[str, Any]:
        return self._get_orchestrator().ask(
            query,
            context=context,
            temperature=temperature,
            max_tokens=max_tokens,
            agent=agent,
            tools=tools,
            system_prompt=system_prompt,
            operator_id=operator_id,
            prior_messages=prior_messages,
        )

    def _detect_agent_intent(self, query: str) -> Optional[str]:
        return self._get_orchestrator()._detect_agent_intent(query)

    def _build_tools(self, tool_names: List[str]) -> List[BaseTool]:
        return self._get_orchestrator()._build_tools(tool_names)

    def _run_agent(
        self,
        query,
        messages,
        agent_name,
        tool_names,
        temperature,
        max_tokens,
        *,
        system_prompt=None,
        operator_id=None,
        prior_messages=None,
    ) -> Dict[str, Any]:
        return self._get_orchestrator()._run_agent(
            query,
            messages,
            agent_name,
            tool_names,
            temperature,
            max_tokens,
            system_prompt=system_prompt,
            operator_id=operator_id,
            prior_messages=prior_messages,
        )

    def wire_channel(self, channel_bridge: Any) -> None:
        """Register a message handler on *channel_bridge* that routes every
        incoming message through this system (agent or engine) and replies.

        Sessions are isolated per ``"<channel>:<conversation_id>"`` key so
        each chat retains its own history.

        Parameters
        ----------
        channel_bridge:
            A connected :class:`~luna.channels._stubs.BaseChannel`
            instance whose ``on_message`` method accepts a callable.
        """
        from qlix.luna.core.types import Message
        from qlix.luna.sessions.session import SessionStore

        if self.session_store is None:
            from pathlib import Path

            self.session_store = SessionStore(
                db_path=Path(self.config.sessions.db_path).expanduser(),
                max_age_hours=self.config.sessions.max_age_hours,
                consolidation_threshold=self.config.sessions.consolidation_threshold,
            )

        _system = self  # capture for closure

        def _on_channel_message(cm) -> None:
            session_key = f"{cm.channel}:{cm.conversation_id}"
            session = _system.session_store.get_or_create(
                session_key,
                channel=cm.channel,
                channel_user_id=cm.sender,
            )

            prior_msgs: List[Message] = []
            for sm in session.messages:
                try:
                    role = Role(sm.role)
                except ValueError:
                    role = Role.USER
                prior_msgs.append(Message(role=role, content=sm.content))

            reply = ""
            try:
                if _system.agent_name and _system.agent_name != "none":
                    result = _system.ask(
                        cm.content,
                        context=False,
                        agent=_system.agent_name,
                        prior_messages=prior_msgs,
                    )
                    reply = result.get("content", "")
                else:
                    result = _system.ask(
                        cm.content,
                        context=False,
                        prior_messages=prior_msgs,
                    )
                    reply = result.get("content", "")
            except Exception:
                logger.exception("Channel message handler error")
                reply = "Sorry, I encountered an error processing your message."

            try:
                _system.session_store.save_message(
                    session.session_id,
                    "user",
                    cm.content,
                    channel=cm.channel,
                )
                _system.session_store.save_message(
                    session.session_id,
                    "assistant",
                    reply,
                    channel=cm.channel,
                )
            except Exception:
                logger.debug("Session save error", exc_info=True)

            if reply:
                try:
                    channel_bridge.send(
                        cm.channel,
                        reply,
                        conversation_id=cm.conversation_id,
                    )
                except Exception:
                    logger.exception("Channel send error")

        channel_bridge.on_message(_on_channel_message)

    def _close_mcp_clients(self) -> None:
        """Close all persistent MCP client connections."""
        for client in self._mcp_clients:
            try:
                client.close()
            except Exception:
                logger.debug("Error closing MCP client", exc_info=True)

    def close(self) -> None:
        """Release resources."""
        if self.scheduler and hasattr(self.scheduler, "stop"):
            self.scheduler.stop()
        for resource in (
            self.scheduler_store,
            self.engine,
            self.gpu_monitor,
            self.telemetry_store,
            self.trace_store,
            self.memory_backend,
            self.session_store,
            self.channel_backend,
            self.workflow_engine,
            self.container_runner,
        ):
            if resource and hasattr(resource, "close"):
                resource.close()
        if self.agent_manager is not None:
            self.agent_manager.close()
        if self.agent_scheduler is not None:
            self.agent_scheduler.stop()
        self._close_mcp_clients()

    def __enter__(self) -> LunaSystem:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


__all__ = ["LunaSystem"]
