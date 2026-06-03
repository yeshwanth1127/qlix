"""Cloud runner: OpenAI-style browser tools via Luna (agent-browser or Playwright) + Qlix scopes."""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

from .identity import AgentIdentity
from .luna.core.registry import ToolRegistry

logger = logging.getLogger(__name__)


try:
    import qlix.luna.tools.browser  # noqa: F401
    import qlix.luna.tools.browser_axtree  # noqa: F401
except ImportError:
    pass
try:
    import qlix.luna.tools.agent_browser_suite  # noqa: F401
except ImportError:
    pass

try:
    from qlix.luna.browser.agent_browser_cli import (
        AGENT_BROWSER_TOOL_IDS,
        AGENT_BROWSER_TOOL_SCOPES,
    )
except ImportError:
    AGENT_BROWSER_TOOL_IDS = ()  # type: tuple[str, ...]
    AGENT_BROWSER_TOOL_SCOPES: dict[str, tuple[str, ...]] = {}

_MAX_FRAME_BYTES = 1_200_000


def _use_agent_browser_suite() -> bool:
    raw = os.environ.get("LUNA_BROWSER_ENGINE", "playwright").strip().lower()
    return raw in ("agent_browser", "agent-browser", "agentbrowser")


def browser_tool_order() -> tuple[str, ...]:
    """Return only agent-browser tools (no legacy 6-tool fallback)."""
    if not AGENT_BROWSER_TOOL_IDS:
        raise RuntimeError("agent-browser tools not available; ensure LUNA_BROWSER_ENGINE is configured")
    return AGENT_BROWSER_TOOL_IDS


def browser_tool_scopes() -> dict[str, tuple[str, ...]]:
    """Return scope requirements for agent-browser tools only."""
    if not AGENT_BROWSER_TOOL_SCOPES:
        raise RuntimeError("agent-browser tool scopes not available")
    return dict(AGENT_BROWSER_TOOL_SCOPES)


def browser_frame_tools() -> frozenset[str]:
    """Agent-browser tools that mutate page state and need frame capture.

    OPTIMIZATION: Only mutation tools should trigger frame capture; read-only tools are skipped.

    Read-only tools (no capture):
    - get, is, find, snapshot (query operations)
    - console, errors (debugging info)
    - session, keyboard, keydown, keyup, device (state management)
    - highlight, state, close, trace, record (non-visual)
    - exec (script execution)

    Mutation tools (capture frame):
    - open, click, dblclick, fill, type (obvious page changes)
    - check, uncheck, select, upload (form interactions)
    - scroll, scrollinto, screenshot (view changes)
    - set, cookies, storage (page state changes)
    """
    # agent-browser tools that DON'T mutate page state
    no_capture = frozenset(
        {
            "browser_ab_get",
            "browser_ab_is",
            "browser_ab_find",
            "browser_ab_snapshot",
            "browser_ab_console",
            "browser_ab_errors",
            "browser_ab_highlight",
            "browser_ab_state",
            "browser_ab_session",
            "browser_ab_keyboard",
            "browser_ab_keydown",
            "browser_ab_keyup",
            "browser_ab_device",
            "browser_ab_close",
            "browser_ab_trace",
            "browser_ab_record",
            "browser_exec",
        }
    )

    out: set[str] = set()
    for tid in browser_tool_order():
        # Include everything EXCEPT the no_capture list
        if tid not in no_capture:
            out.add(tid)

    return frozenset(out)


def should_capture_browser_frame(tool_name: str) -> bool:
    resolved = resolve_tool_name(tool_name)
    frames = browser_frame_tools()
    return resolved in frames or tool_name in frames


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def resolve_tool_name(tool_name: str) -> str:
    """Resolve tool name (no legacy aliasing needed—only agent-browser tools)."""
    return tool_name


def _remap_legacy_params(tool_name: str, resolved: str, params: dict[str, Any]) -> dict[str, Any]:
    """No parameter remapping needed—agent-browser tools use native params."""
    return params


def openai_browser_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    """Generate OpenAI-compatible tool definitions for agent-browser tools only.

    Filters by:
    1. Agent's permission scopes (web.read, web.click, etc.)
    2. Skill filter (if provided; narrows available tools further)
    """
    granted = _effective_granted_scopes(identity)
    ids = list(browser_tool_order())
    scopes = browser_tool_scopes()

    # Narrow by skill filter if provided.
    # skill_filter may contain scope names (e.g. 'web.read' from team delegatedScopes)
    # or tool IDs (e.g. 'browser_ab_click'). Scope names contain '.'; tool IDs don't.
    # When scope names are present, include tools whose required scopes overlap the filter.
    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            # Scope-based filter (team worker runs): include tool if any required scope is in filt
            ids = [t for t in ids if any(s in filt for s in scopes.get(t, ()))]
        else:
            # Tool-ID-based filter: match directly
            ids = [t for t in ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in ids:
        # Skip if agent lacks required scopes for this tool
        req = scopes.get(tid, ())
        if any(s not in granted for s in req):
            continue
        try:
            cls = ToolRegistry.get(tid)
            out.append(cls().to_openai_function())
        except KeyError:
            continue
    return out


_LIVE_VIEW_KEYWORDS: frozenset[str] = frozenset({
    "screenshot",
    "screen shot",
    "live view",
    "live update",
    "live browser",
    "browser view",
    "browser screenshot",
    "capture screen",
    "record browser",
    "watch browser",
    "browser live",
    "show browser",
    "see the browser",
    "visual browser",
})


def goal_requests_live_view(text: str) -> bool:
    """Return True if the goal/prompt explicitly requests browser screenshots or live view."""
    lower = text.lower()
    return any(kw in lower for kw in _LIVE_VIEW_KEYWORDS)


def is_browser_tool(tool_name: str) -> bool:
    return should_capture_browser_frame(tool_name)


def browser_action_label(tool_name: str, params: dict[str, Any]) -> str:
    if tool_name == "browser_ab_open":
        url = str(params.get("url", ""))
        return ("Navigate " + url[:120]) if url else "Navigate"
    if tool_name == "browser_ab_click":
        sel = str(params.get("selector", params.get("value", "")))
        return ("Click " + sel[:80]) if sel else "Click"
    if tool_name in ("browser_ab_fill", "browser_ab_type"):
        sel = str(params.get("selector", ""))
        text = str(params.get("text", ""))
        preview = text[:40] + ("..." if len(text) > 40 else "")
        return ("Type " + preview + " into " + sel[:60]) if sel else ("Type " + preview)
    if tool_name == "browser_ab_snapshot":
        return "Read page structure"
    if tool_name == "browser_ab_screenshot":
        return "Screenshot"
    if tool_name == "browser_ab_find":
        loc = str(params.get("locator", ""))
        act = str(params.get("action", ""))
        return "Find " + loc + " " + act
    if tool_name == "browser_exec":
        argv = params.get("argv")
        if isinstance(argv, list) and argv:
            joined = " ".join(str(x) for x in argv)[:100]
            return "CLI: " + joined
    clean = tool_name.replace("browser_ab_", "").replace("_", " ")
    return clean.title() if clean else tool_name


def capture_browser_frame_for_ui(enabled: bool = False) -> dict[str, str] | None:
    if not enabled:
        return None
    try:
        from qlix.luna.browser.factory import get_browser_driver

        raw = get_browser_driver().screenshot_bytes(full_page=False)
        if len(raw) > _MAX_FRAME_BYTES:
            logger.warning("browser_frame_skip size=%s", len(raw))
            return None
        return {
            "mime": "image/png",
            "image_base64": base64.b64encode(raw).decode("ascii"),
        }
    except Exception as exc:
        logger.warning("browser_frame_capture_failed: %s", exc)
        return None


def tool_allowed_for_identity(tool_name: str, identity: AgentIdentity) -> bool:
    granted = _effective_granted_scopes(identity)
    resolved = resolve_tool_name(tool_name)
    scopes = browser_tool_scopes()
    req = scopes.get(resolved, scopes.get(tool_name, ()))
    return all(s in granted for s in req)


def smart_truncate_tool_result(
    tool_name: str,
    result: str,
) -> tuple[str, bool]:
    """Intelligently truncate tool results while preserving context.

    OPTIMIZATION: Different tools benefit from different truncation strategies:
    - Accessibility tree: preserve line structure (important for agent to understand page)
    - Text extraction: truncate at paragraph boundaries
    - Other tools: standard truncation

    Returns (truncated_result, was_truncated).
    """
    # Accessibility tree: preserve line structure (up to N lines)
    if tool_name == "browser_ab_snapshot":
        max_lines = 500  # ≈ 5-10K tokens depending on nesting depth
        lines = result.split("\n")
        if len(lines) > max_lines:
            truncated = "\n".join(lines[:max_lines])
            truncated += f"\n\n[AX tree truncated: {len(lines)} total nodes, showing {max_lines}]"
            return truncated, True
        return result, False

    # Text extraction: truncate to word/paragraph boundary
    if tool_name == "browser_ab_get":
        max_chars = 10_000
        if len(result) > max_chars:
            # Try to truncate at paragraph boundary (double newline)
            para_pos = result.rfind("\n\n", 0, max_chars)
            if para_pos > max_chars * 0.8:
                truncated = result[:para_pos]
            else:
                truncated = result[:max_chars]
            truncated += f"\n\n[Content truncated from {len(result)} chars]"
            return truncated, True
        return result, False

    # Default: 120K characters (plenty for most uses)
    max_chars = 120_000
    if len(result) > max_chars:
        truncated = result[:max_chars]
        truncated += f"\n\n[Output truncated from {len(result)} chars]"
        return truncated, True

    return result, False


def execute_browser_tool_sync(tool_name: str, arguments_json: str, identity: AgentIdentity) -> str:
    original_name = tool_name
    tool_name = resolve_tool_name(tool_name)
    try:
        from qlix.luna.browser.factory import browser_engine_name, get_browser_engine_info

        info = get_browser_engine_info()
        logger.info(
            "browser_tool_execute tool=%s resolved=%s engine=%s binary=%s",
            original_name,
            tool_name,
            browser_engine_name(),
            info.get("binary", "n/a"),
        )
    except Exception:
        logger.info("browser_tool_execute tool=%s resolved=%s", original_name, tool_name)
    if not tool_allowed_for_identity(original_name, identity):
        return f"Tool '{original_name}' denied: missing permission scope for this agent."
    try:
        params = json.loads(arguments_json) if arguments_json.strip() else {}
        if not isinstance(params, dict):
            params = {}
    except json.JSONDecodeError as exc:
        return f"Invalid tool arguments JSON: {exc}"
    if original_name != tool_name:
        params = _remap_legacy_params(original_name, tool_name, params)
    try:
        if _use_agent_browser_suite() and (
            tool_name.startswith("browser_ab_") or tool_name == "browser_exec"
        ):
            from qlix.luna.browser.agent_browser_cli import run_agent_browser_tool

            ok, content = run_agent_browser_tool(
                tool_name,
                params,
                granted_scopes=_effective_granted_scopes(identity),
            )
            return ("" if ok else "[failed] ") + content
        cls = ToolRegistry.get(tool_name)
        result = cls().execute(**params)
        return ("" if result.success else "[failed] ") + (result.content or "")
    except KeyError:
        return f"Unknown tool: {original_name}"
    except Exception as exc:
        logger.exception("tool_execute_error %s", tool_name)
        return f"Tool error ({tool_name}): {exc}"
