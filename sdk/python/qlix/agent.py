"""@qlix.agent — ADK decorator for defining deployable agents.

The decorator is the developer-facing API. Internally it produces an
:class:`AgentMeta` that serializes to an **agent manifest** — a
JSON-safe dict that is the single source of truth for:

  * Dashboard display and editing
  * ``qlix deploy`` pushing a local agent to the cloud
  * The cloud worker service running the agent without Python on the server

Usage::

    @qlix.agent(
        name="research-agent",
        description="Does web research and emails summaries",
        system_prompt="You are a helpful research agent.",
        model="claude-sonnet-4-6",
        connectors=["gmail", "gcalendar"],
    )
    class ResearchAgent:
        @qlix.tool(scope="web.read", risk="low", description="Fetch a web page")
        async def fetch_page(self, url: str) -> str:
            ...

        @qlix.tool(scope="gmail.send", risk="medium", description="Send an email")
        async def send_email(self, to: str, subject: str, body: str) -> None:
            ...

    # Serialize → manifest
    manifest = ResearchAgent.to_manifest()   # dict
    json_str = ResearchAgent.manifest_json() # str
"""

from __future__ import annotations

import inspect
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Type

from .dev import is_dev_mode

from .tool import ToolMeta

MANIFEST_VERSION = "1"

# ---------------------------------------------------------------------------
# Connector scope registry
# ---------------------------------------------------------------------------

# Maps connector_id → list of scopes it exposes.
# When a connector is declared on an agent, its known scopes are automatically
# added to permission_scopes in the manifest.
_CONNECTOR_SCOPES: dict[str, list[str]] = {
    "gmail": ["gmail.read", "gmail.send", "gmail.delete"],
    "gcalendar": ["gcalendar.read", "gcalendar.write"],
    "gdrive": ["gdrive.read", "gdrive.write"],
    "gcontacts": ["gcontacts.read"],
    "google_tasks": ["google_tasks.read", "google_tasks.write"],
    "slack": ["slack.read", "slack.send"],
    "notion": ["notion.read", "notion.write"],
    "github": ["github.read", "github.write"],
    "outlook": ["outlook.read", "outlook.send"],
    "obsidian": ["obsidian.read", "obsidian.write"],
    "dropbox": ["dropbox.read", "dropbox.write"],
    "oura": ["oura.read"],
    "spotify": ["spotify.read", "spotify.control"],
    "hackernews": ["hackernews.read"],
}


def register_connector_scopes(connector_id: str, scopes: list[str]) -> None:
    """Register scopes for a custom connector not in the built-in registry.

    Call this once at import time in your connector module::

        qlix.register_connector_scopes("my_service", ["my_service.read", "my_service.write"])
    """
    _CONNECTOR_SCOPES[connector_id] = scopes


# ---------------------------------------------------------------------------
# AgentMeta — the in-memory representation of a declared agent
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AgentMeta:
    """Immutable representation of a @qlix.agent-decorated class.

    This is the bridge between the decorator API and the manifest format.
    It holds everything needed to serialize, deploy, or run the agent.
    """

    name: str
    description: str
    system_prompt: str
    model: str
    tools: tuple[ToolMeta, ...]
    connectors: tuple[str, ...]
    permission_scopes: tuple[str, ...]
    created_at: str  # ISO-8601, stamped once at decoration time

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable manifest dict.

        This is what ``qlix deploy`` uploads and what the cloud worker reads.
        """
        return {
            "manifest_version": MANIFEST_VERSION,
            "name": self.name,
            "description": self.description,
            "system_prompt": self.system_prompt,
            "model": self.model,
            "tools": [
                {
                    "scope": t.scope,
                    "risk_level": t.risk_level,
                    "description": t.description,
                    "parameters": t.parameters,
                }
                for t in self.tools
            ],
            "connectors": list(self.connectors),
            "permission_scopes": list(self.permission_scopes),
            "created_at": self.created_at,
        }


# ---------------------------------------------------------------------------
# @qlix.agent decorator
# ---------------------------------------------------------------------------


def agent(
    name: str,
    *,
    description: str = "",
    system_prompt: str = "",
    model: str = "",
    connectors: list[str] | None = None,
) -> Callable[[Type[Any]], Type[Any]]:
    """Decorator that turns a class into a Qlix deployable agent.

    Parameters
    ----------
    name:
        Unique agent name. Used as the identifier in the dashboard and on deploy.
    description:
        One-line description shown in the dashboard.
    system_prompt:
        The system prompt the LLM receives at the start of every conversation.
    model:
        LLM model ID (e.g. ``"claude-sonnet-4-6"``). Falls back to the agent
        identity's default when empty.
    connectors:
        List of connector IDs to auto-register (e.g. ``["gmail", "gcalendar"]``).
        Their known scopes are merged into ``permission_scopes`` automatically.

    What the decorated class gains
    --------------------------------
    ``._qlix_agent``
        The :class:`AgentMeta` instance. Inspect this programmatically.
    ``.to_manifest() -> dict``
        Returns the agent manifest as a JSON-serializable dict.
    ``.manifest_json(indent=2) -> str``
        Returns the manifest as a formatted JSON string.
    """

    def decorator(cls: Type[Any]) -> Type[Any]:
        # --- Collect @qlix.tool-decorated methods ----------------------------
        tools: list[ToolMeta] = []
        for _name, member in inspect.getmembers(cls, predicate=inspect.isfunction):
            meta = getattr(member, "_qlix_tool", None)
            if isinstance(meta, ToolMeta):
                tools.append(meta)

        # --- Connector auto-registration: merge scopes ----------------------
        _connectors: list[str] = connectors or []
        scope_set: set[str] = {t.scope for t in tools}
        for conn_id in _connectors:
            known = _CONNECTOR_SCOPES.get(conn_id)
            if known is None:
                raise ValueError(
                    f"Unknown connector '{conn_id}'. "
                    f"Register it first with qlix.register_connector_scopes(). "
                    f"Known connectors: {sorted(_CONNECTOR_SCOPES)}"
                )
            scope_set.update(known)

        permission_scopes = tuple(sorted(scope_set))

        # --- Scope ceiling enforcement ---------------------------------------
        # If an active SDK is present, validate that every scope the agent
        # declares was actually granted in agent.json. Catches mismatches
        # at class-definition time rather than at backend deploy time.
        # Skipped in dev mode (no real identity) and when no SDK is active yet.
        if not is_dev_mode():
            try:
                from .luna._gate import get_active_sdk
                active_sdk = get_active_sdk()
                if active_sdk is not None:
                    granted: set[str] = set(active_sdk.identity.permission_scopes)
                    # "*" in granted means all scopes are allowed (e.g. dev identity)
                    if "*" not in granted:
                        ungranted = sorted(s for s in permission_scopes if s not in granted)
                        if ungranted:
                            raise ValueError(
                                f"Agent '{name}' declares scopes not granted in agent.json: "
                                f"{ungranted}. Grant them in the Qlix dashboard first."
                            )
            except ImportError:
                pass  # Luna not available; skip the check

        agent_meta = AgentMeta(
            name=name,
            description=description,
            system_prompt=system_prompt,
            model=model,
            tools=tuple(tools),
            connectors=tuple(_connectors),
            permission_scopes=permission_scopes,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        # --- Attach metadata and serialization methods to the class ---------
        cls._qlix_agent = agent_meta

        def _to_manifest(klass: Type[Any]) -> dict[str, Any]:
            return agent_meta.to_dict()

        def _manifest_json(klass: Type[Any], *, indent: int = 2) -> str:
            return json.dumps(agent_meta.to_dict(), indent=indent, ensure_ascii=False)

        cls.to_manifest = classmethod(_to_manifest)
        cls.manifest_json = classmethod(_manifest_json)

        return cls

    return decorator


__all__ = ["AgentMeta", "agent", "register_connector_scopes"]
