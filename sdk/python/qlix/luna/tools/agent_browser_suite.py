"""Luna tools — full agent-browser CLI surface (one tool per command group + browser_exec)."""

from __future__ import annotations

from typing import Any

from qlix.luna.browser.agent_browser_cli import (
    AGENT_BROWSER_TOOL_DEFS,
    run_agent_browser_tool,
)
from qlix.luna.core.registry import ToolRegistry
from qlix.luna.core.types import ToolResult
from qlix.luna.tools._stubs import BaseTool, ToolSpec


def _make_agent_browser_tool_class(defn: Any) -> type[BaseTool]:
    _tid = defn.tool_id
    _description = defn.description
    _parameters = defn.parameters

    class _AgentBrowserTool(BaseTool):
        tool_id = _tid
        is_local = False

        @property
        def spec(self) -> ToolSpec:
            return ToolSpec(
                name=_tid,
                description=_description,
                parameters=_parameters,
                category="browser",
                required_capabilities=["network:fetch"],
            )

        def execute(self, **params: Any) -> ToolResult:
            ok, content = run_agent_browser_tool(_tid, params)
            return ToolResult(tool_name=_tid, content=content, success=ok)

    _AgentBrowserTool.__name__ = f"_{_tid}"
    return _AgentBrowserTool


def register_agent_browser_tools() -> None:
    """Register all agent-browser CLI tools with Luna (idempotent)."""
    for defn in AGENT_BROWSER_TOOL_DEFS:
        if ToolRegistry.contains(defn.tool_id):
            continue
        cls = _make_agent_browser_tool_class(defn)
        ToolRegistry.register(defn.tool_id)(cls)


register_agent_browser_tools()
