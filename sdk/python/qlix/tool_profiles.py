"""OpenClaw-style tool profiles — filter effective scopes before ToolRouter builds the catalog."""

from __future__ import annotations

_MINIMAL = frozenset(
    {
        "web.read",
        "web.research",
        "brain.query",
        "brain.knowledge_read",
    }
)
_CODING = _MINIMAL | frozenset(
    {
        "web.click",
        "system.file_read",
        "system.file_write",
    }
)


def filter_scopes_by_tool_profile(scopes: list[str], profile: str | None) -> list[str]:
    """Narrow granted scopes by profile.

    ``lean`` is not a scope filter — it keeps every scope but drops rarely-used
    management tools from the schema (see tool_budget.ADMIN_TOOLS). It is applied
    later, on the assembled tool list, so it works uniformly across connectors.
    """
    p = (profile or "full").strip().lower()
    if p in ("full", "lean") or not p:
        return list(scopes)
    allow = _MINIMAL if p == "minimal" else _CODING
    return [s for s in scopes if s in allow or str(s).startswith("mcp.")]
