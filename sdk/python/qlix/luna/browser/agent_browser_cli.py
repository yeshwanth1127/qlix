"""agent-browser CLI manifest, argv builders, and execution helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

# Root verbs allowed for browser_exec (install/chat excluded — use runner image / Qlix agent).
ALLOWED_ROOT_VERBS = frozenset(
    {
        "open",
        "click",
        "dblclick",
        "type",
        "fill",
        "press",
        "hover",
        "focus",
        "check",
        "uncheck",
        "select",
        "drag",
        "upload",
        "download",
        "scroll",
        "scrollintoview",
        "scrollinto",
        "wait",
        "screenshot",
        "pdf",
        "snapshot",
        "eval",
        "connect",
        "close",
        "back",
        "forward",
        "reload",
        "get",
        "is",
        "find",
        "mouse",
        "set",
        "network",
        "cookies",
        "storage",
        "tab",
        "trace",
        "record",
        "console",
        "errors",
        "highlight",
        "session",
        "keyboard",
        "keydown",
        "keyup",
        "state",
        "stream",
        "batch",
        "swipe",
        "tap",
        "device",
    }
)

BLOCKED_ROOT_VERBS = frozenset({"install", "upgrade", "chat", "doctor"})


@dataclass(frozen=True)
class AgentBrowserToolDef:
    """Luna tool mapped to agent-browser CLI argv."""

    tool_id: str
    cli_argv: tuple[str, ...]  # static prefix, e.g. ("get", "text")
    description: str
    parameters: dict[str, Any]
    scopes: tuple[str, ...]
    build_argv: Callable[[dict[str, Any]], list[str]]


def _argv_from_params(static: tuple[str, ...], params: dict[str, Any], *keys: str) -> list[str]:
    out = list(static)
    for key in keys:
        val = params.get(key)
        if val is None:
            continue
        if isinstance(val, bool):
            if val:
                out.append(f"--{key.replace('_', '-')}")
            continue
        if isinstance(val, list):
            out.extend(str(x) for x in val)
            continue
        s = str(val).strip()
        if s:
            out.append(s)
    return out


def _build_open(params: dict[str, Any]) -> list[str]:
    url = str(params.get("url", "")).strip()
    return ["open", url] if url else ["open"]


def _build_simple(verb: str, *param_keys: str) -> Callable[[dict[str, Any]], list[str]]:
    def _builder(params: dict[str, Any]) -> list[str]:
        return _argv_from_params((verb,), params, *param_keys)

    return _builder


def _build_find(params: dict[str, Any]) -> list[str]:
    locator = str(params.get("locator", "")).strip()
    value = str(params.get("value", "")).strip()
    action = str(params.get("action", "")).strip()
    if not locator or not value or not action:
        raise ValueError("find requires locator, value, and action")
    argv = ["find", locator, value, action]
    for opt in ("text", "name"):
        v = params.get(opt)
        if v is not None and str(v).strip():
            argv.extend([f"--{opt}", str(v).strip()])
    return argv


def _build_get(params: dict[str, Any]) -> list[str]:
    what = str(params.get("what", "")).strip()
    if not what:
        raise ValueError("get requires what")
    argv = ["get", what]
    sel = params.get("selector")
    if sel is not None and str(sel).strip():
        argv.append(str(sel).strip())
    attr = params.get("attribute")
    if what == "attr" and attr is not None and str(attr).strip():
        argv.append(str(attr).strip())
    return argv


def _build_is(params: dict[str, Any]) -> list[str]:
    what = str(params.get("what", "")).strip()
    selector = str(params.get("selector", "")).strip()
    if not what or not selector:
        raise ValueError("is requires what and selector")
    return ["is", what, selector]


def _build_mouse(params: dict[str, Any]) -> list[str]:
    action = str(params.get("action", "")).strip()
    if not action:
        raise ValueError("mouse requires action")
    argv = ["mouse", action]
    for key in ("x", "y", "button", "delta_y", "delta_x"):
        v = params.get(key)
        if v is not None and str(v).strip():
            argv.append(str(v).strip())
    return argv


def _build_set(params: dict[str, Any]) -> list[str]:
    setting = str(params.get("setting", "")).strip()
    if not setting:
        raise ValueError("set requires setting")
    argv = ["set", setting]
    for key in ("width", "height", "value", "latitude", "longitude", "username", "password", "json"):
        v = params.get(key)
        if v is not None and str(v).strip():
            argv.append(str(v).strip())
    return argv


def _build_network(params: dict[str, Any]) -> list[str]:
    action = str(params.get("action", "")).strip()
    if not action:
        raise ValueError("network requires action")
    argv = ["network", action]
    for key in ("url", "body", "filter", "abort"):
        v = params.get(key)
        if v is None:
            continue
        if key == "abort" and v:
            argv.append("--abort")
        elif str(v).strip():
            if key == "body":
                argv.extend(["--body", str(v).strip()])
            elif key == "filter":
                argv.extend(["--filter", str(v).strip()])
            else:
                argv.append(str(v).strip())
    return argv


def _build_cookies(params: dict[str, Any]) -> list[str]:
    action = str(params.get("action", "get")).strip() or "get"
    return _argv_from_params(("cookies", action), params, "url", "domain", "path", "name", "value")


def _build_storage(params: dict[str, Any]) -> list[str]:
    kind = str(params.get("kind", "local")).strip() or "local"
    argv = ["storage", kind]
    action = params.get("action")
    if action is not None and str(action).strip():
        argv.append(str(action).strip())
    key = params.get("key")
    if key is not None and str(key).strip():
        argv.extend(["--key", str(key).strip()])
    val = params.get("value")
    if val is not None:
        argv.extend(["--value", str(val)])
    return argv


def _build_tab(params: dict[str, Any]) -> list[str]:
    action = str(params.get("action", "list")).strip() or "list"
    argv = ["tab", action]
    index = params.get("index")
    if index is not None and str(index).strip():
        argv.append(str(index).strip())
    return argv


def _build_trace(params: dict[str, Any]) -> list[str]:
    action = str(params.get("action", "start")).strip() or "start"
    argv = ["trace", action]
    path = params.get("path")
    if path is not None and str(path).strip():
        argv.append(str(path).strip())
    return argv


def _build_record(params: dict[str, Any]) -> list[str]:
    action = str(params.get("action", "start")).strip() or "start"
    argv = ["record", action]
    for key in ("path", "url"):
        v = params.get(key)
        if v is not None and str(v).strip():
            argv.append(str(v).strip())
    return argv


def _build_wait(params: dict[str, Any]) -> list[str]:
    if params.get("selector"):
        return ["wait", str(p["selector"]).strip()]
    if params.get("milliseconds") is not None:
        return ["wait", str(int(p["milliseconds"]))]
    if params.get("text"):
        return ["wait", "--text", str(p["text"]).strip()]
    if params.get("url_pattern"):
        return ["wait", "--url", str(p["url_pattern"]).strip()]
    if params.get("load_state"):
        return ["wait", "--load", str(p["load_state"]).strip()]
    if params.get("js"):
        return ["wait", "--fn", str(p["js"]).strip()]
    raise ValueError("wait requires one of selector, milliseconds, text, url_pattern, load_state, js")


def _build_exec(params: dict[str, Any]) -> list[str]:
    argv = params.get("argv")
    if not isinstance(argv, list) or not argv:
        raise ValueError("argv must be a non-empty array of strings")
    out = [str(x) for x in argv]
    root = out[0].strip().lower()
    if root in BLOCKED_ROOT_VERBS:
        raise ValueError(f"command '{root}' is not allowed via browser_exec")
    if root not in ALLOWED_ROOT_VERBS:
        raise ValueError(f"unknown or disallowed command '{root}'")
    flags = params.get("flags")
    if isinstance(flags, dict):
        for k, v in flags.items():
            flag = f"--{str(k).replace('_', '-')}"
            if v is True:
                out.append(flag)
            elif v is not False and v is not None and str(v).strip():
                out.extend([flag, str(v).strip()])
    return out


def _sel_schema(*, required: list[str] | None = None) -> dict[str, Any]:
    props: dict[str, Any] = {
        "selector": {"type": "string", "description": "CSS selector or @ref from snapshot."},
    }
    req = required or []
    return {"type": "object", "properties": props, "required": req}


# fmt: off
AGENT_BROWSER_TOOL_DEFS: tuple[AgentBrowserToolDef, ...] = (
    AgentBrowserToolDef(
        "browser_ab_open",
        ("open",),
        "Navigate with agent-browser `open <url>`. Prefer snapshot after open to get @refs.",
        {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to open (https://...)."},
            },
            "required": ["url"],
        },
        ("web.read",),
        _build_open,
    ),
    AgentBrowserToolDef(
        "browser_ab_snapshot",
        ("snapshot",),
        "Accessibility tree with @refs (agent-browser snapshot). Use -i for interactive-only. Click/fill using @eN refs.",
        {
            "type": "object",
            "properties": {
                "interactive_only": {"type": "boolean", "description": "Maps to snapshot -i."},
                "compact": {"type": "boolean", "description": "Maps to snapshot -c."},
                "depth": {"type": "integer", "description": "Max tree depth (-d)."},
                "selector": {"type": "string", "description": "Scope snapshot to CSS selector (-s)."},
            },
        },
        ("web.read",),
        lambda p: ["snapshot"]
        + (["-i"] if p.get("interactive_only") else [])
        + (["-c"] if p.get("compact") else [])
        + (["-d", str(int(p["depth"]))] if p.get("depth") is not None else [])
        + (["-s", str(p["selector"]).strip()] if p.get("selector") else []),
    ),
    AgentBrowserToolDef(
        "browser_ab_click",
        ("click",),
        "Click element by selector or @ref from snapshot.",
        _sel_schema(required=["selector"]),
        ("web.read", "web.click"),
        _build_simple("click", "selector"),
    ),
    AgentBrowserToolDef(
        "browser_ab_dblclick",
        ("dblclick",),
        "Double-click element.",
        _sel_schema(required=["selector"]),
        ("web.read", "web.click"),
        _build_simple("dblclick", "selector"),
    ),
    AgentBrowserToolDef(
        "browser_ab_type",
        ("type",),
        "Type into element (append). Use browser_ab_fill to clear first.",
        {
            "type": "object",
            "properties": {
                "selector": {"type": "string"},
                "text": {"type": "string"},
            },
            "required": ["selector", "text"],
        },
        ("web.read", "web.click"),
        _build_simple("type", "selector", "text"),
    ),
    AgentBrowserToolDef(
        "browser_ab_fill",
        ("fill",),
        "Clear field and fill (agent-browser fill).",
        {
            "type": "object",
            "properties": {
                "selector": {"type": "string"},
                "text": {"type": "string"},
            },
            "required": ["selector", "text"],
        },
        ("web.read", "web.click"),
        _build_simple("fill", "selector", "text"),
    ),
    AgentBrowserToolDef(
        "browser_ab_press",
        ("press",),
        "Press a key (Enter, Tab, Control+a, etc.).",
        {
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"],
        },
        ("web.read", "web.click"),
        lambda p: ["press", str(p["key"]).strip()],
    ),
    AgentBrowserToolDef(
        "browser_ab_hover",
        ("hover",),
        "Hover element.",
        _sel_schema(required=["selector"]),
        ("web.read", "web.click"),
        _build_simple("hover", "selector"),
    ),
    AgentBrowserToolDef(
        "browser_ab_focus",
        ("focus",),
        "Focus element.",
        _sel_schema(required=["selector"]),
        ("web.read", "web.click"),
        _build_simple("focus", "selector"),
    ),
    AgentBrowserToolDef(
        "browser_ab_check",
        ("check",),
        "Check checkbox.",
        _sel_schema(required=["selector"]),
        ("web.read", "web.click"),
        _build_simple("check", "selector"),
    ),
    AgentBrowserToolDef(
        "browser_ab_uncheck",
        ("uncheck",),
        "Uncheck checkbox.",
        _sel_schema(required=["selector"]),
        ("web.read", "web.click"),
        _build_simple("uncheck", "selector"),
    ),
    AgentBrowserToolDef(
        "browser_ab_select",
        ("select",),
        "Select dropdown option(s).",
        {
            "type": "object",
            "properties": {
                "selector": {"type": "string"},
                "values": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Option value(s) to select.",
                },
            },
            "required": ["selector", "values"],
        },
        ("web.read", "web.click"),
        lambda p: ["select", str(p["selector"]).strip(), *[str(v) for v in p.get("values", [])]],
    ),
    AgentBrowserToolDef(
        "browser_ab_drag",
        ("drag",),
        "Drag from source selector to target selector.",
        {
            "type": "object",
            "properties": {
                "source": {"type": "string"},
                "target": {"type": "string"},
            },
            "required": ["source", "target"],
        },
        ("web.read", "web.click"),
        lambda p: ["drag", str(p["source"]).strip(), str(p["target"]).strip()],
    ),
    AgentBrowserToolDef(
        "browser_ab_upload",
        ("upload",),
        "Upload files to file input.",
        {
            "type": "object",
            "properties": {
                "selector": {"type": "string"},
                "files": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["selector", "files"],
        },
        ("web.read", "web.click"),
        lambda p: ["upload", str(p["selector"]).strip(), *[str(f) for f in p.get("files", [])]],
    ),
    AgentBrowserToolDef(
        "browser_ab_download",
        ("download",),
        "Download file by clicking element.",
        {
            "type": "object",
            "properties": {
                "selector": {"type": "string"},
                "path": {"type": "string", "description": "Save path in runner."},
            },
            "required": ["selector", "path"],
        },
        ("web.read", "web.click"),
        _build_simple("download", "selector", "path"),
    ),
    AgentBrowserToolDef(
        "browser_ab_scroll",
        ("scroll",),
        "Scroll page (up/down/left/right) optional pixels.",
        {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                "pixels": {"type": "integer"},
                "selector": {"type": "string", "description": "Scroll within element (--selector)."},
            },
            "required": ["direction"],
        },
        ("web.read",),
        lambda p: _argv_from_params(
            ("scroll", str(p["direction"]).strip()),
            p,
            "pixels",
        ),
    ),
    AgentBrowserToolDef(
        "browser_ab_scrollintoview",
        ("scrollintoview",),
        "Scroll element into view.",
        _sel_schema(required=["selector"]),
        ("web.read",),
        _build_simple("scrollintoview", "selector"),
    ),
    AgentBrowserToolDef(
        "browser_ab_wait",
        ("wait",),
        "Wait for selector, ms, text, url, load state, or JS (--fn).",
        {
            "type": "object",
            "properties": {
                "selector": {"type": "string"},
                "milliseconds": {"type": "integer"},
                "text": {"type": "string", "description": "Wait for text (--text)."},
                "url_pattern": {"type": "string", "description": "Wait for URL (--url)."},
                "load_state": {
                    "type": "string",
                    "enum": ["load", "domcontentloaded", "networkidle"],
                    "description": "Wait for load state (--load).",
                },
                "js": {"type": "string", "description": "Wait until JS truthy (--fn)."},
            },
        },
        ("web.read",),
        _build_wait,
    ),
    AgentBrowserToolDef(
        "browser_ab_screenshot",
        ("screenshot",),
        "Screenshot; omit path to return image in JSON. Use full_page for full page.",
        {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "full_page": {"type": "boolean"},
            },
        },
        ("web.read",),
        lambda p: (["screenshot", str(p["path"]).strip()] if p.get("path") else ["screenshot"])
        + (["--full"] if p.get("full_page") else []),
    ),
    AgentBrowserToolDef(
        "browser_ab_pdf",
        ("pdf",),
        "Save page as PDF.",
        {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        ("web.read",),
        _build_simple("pdf", "path"),
    ),
    AgentBrowserToolDef(
        "browser_ab_eval",
        ("eval",),
        "Run JavaScript in page context.",
        {
            "type": "object",
            "properties": {"js": {"type": "string"}},
            "required": ["js"],
        },
        ("web.read",),
        lambda p: ["eval", str(p["js"]).strip()],
    ),
    AgentBrowserToolDef(
        "browser_ab_find",
        ("find",),
        "Find element by locator (role, text, label, placeholder, alt, title, testid, first, last, nth) and act.",
        {
            "type": "object",
            "properties": {
                "locator": {
                    "type": "string",
                    "enum": ["role", "text", "label", "placeholder", "alt", "title", "testid", "first", "last", "nth"],
                },
                "value": {"type": "string"},
                "action": {"type": "string", "description": "click, fill, type, text, etc."},
                "text": {"type": "string", "description": "Extra text for fill/type."},
                "name": {"type": "string", "description": "For role locator (--name)."},
            },
            "required": ["locator", "value", "action"],
        },
        ("web.read", "web.click"),
        _build_find,
    ),
    AgentBrowserToolDef(
        "browser_ab_get",
        ("get",),
        "Get page info: text, html, value, attr, title, url, count, box, styles.",
        {
            "type": "object",
            "properties": {
                "what": {
                    "type": "string",
                    "enum": ["text", "html", "value", "attr", "title", "url", "count", "box", "styles", "cdp-url"],
                },
                "selector": {"type": "string"},
                "attribute": {"type": "string", "description": "Required when what=attr."},
            },
            "required": ["what"],
        },
        ("web.read",),
        _build_get,
    ),
    AgentBrowserToolDef(
        "browser_ab_is",
        ("is",),
        "Check visible, enabled, or checked.",
        {
            "type": "object",
            "properties": {
                "what": {"type": "string", "enum": ["visible", "enabled", "checked"]},
                "selector": {"type": "string"},
            },
            "required": ["what", "selector"],
        },
        ("web.read",),
        _build_is,
    ),
    AgentBrowserToolDef(
        "browser_ab_back",
        ("back",),
        "Browser back.",
        {"type": "object", "properties": {}},
        ("web.read",),
        lambda _p: ["back"],
    ),
    AgentBrowserToolDef(
        "browser_ab_forward",
        ("forward",),
        "Browser forward.",
        {"type": "object", "properties": {}},
        ("web.read",),
        lambda _p: ["forward"],
    ),
    AgentBrowserToolDef(
        "browser_ab_reload",
        ("reload",),
        "Reload page.",
        {"type": "object", "properties": {}},
        ("web.read",),
        lambda _p: ["reload"],
    ),
    AgentBrowserToolDef(
        "browser_ab_mouse",
        ("mouse",),
        "Mouse move, down, up, wheel.",
        {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["move", "down", "up", "wheel"]},
                "x": {"type": "number"},
                "y": {"type": "number"},
                "button": {"type": "string"},
                "delta_y": {"type": "number"},
                "delta_x": {"type": "number"},
            },
            "required": ["action"],
        },
        ("web.read", "web.click"),
        _build_mouse,
    ),
    AgentBrowserToolDef(
        "browser_ab_set",
        ("set",),
        "Browser settings: viewport, device, geo, offline, headers, credentials, media.",
        {
            "type": "object",
            "properties": {
                "setting": {
                    "type": "string",
                    "enum": ["viewport", "device", "geo", "offline", "headers", "credentials", "media"],
                },
                "width": {"type": "integer"},
                "height": {"type": "integer"},
                "value": {"type": "string"},
                "latitude": {"type": "number"},
                "longitude": {"type": "number"},
                "username": {"type": "string"},
                "password": {"type": "string"},
                "json": {"type": "string"},
            },
            "required": ["setting"],
        },
        ("web.read", "web.click"),
        _build_set,
    ),
    AgentBrowserToolDef(
        "browser_ab_network",
        ("network",),
        "Network route, unroute, or list requests.",
        {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["route", "unroute", "requests"]},
                "url": {"type": "string"},
                "body": {"type": "string"},
                "filter": {"type": "string"},
                "abort": {"type": "boolean"},
            },
            "required": ["action"],
        },
        ("web.read", "web.click"),
        _build_network,
    ),
    AgentBrowserToolDef(
        "browser_ab_tab",
        ("tab",),
        "Tab new, list, close, or switch by index.",
        {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["new", "list", "close"]},
                "index": {"type": "integer"},
            },
        },
        ("web.read", "web.click"),
        _build_tab,
    ),
    AgentBrowserToolDef(
        "browser_ab_console",
        ("console",),
        "View browser console logs.",
        {
            "type": "object",
            "properties": {"clear": {"type": "boolean"}},
        },
        ("web.read",),
        lambda p: ["console"] + (["--clear"] if p.get("clear") else []),
    ),
    AgentBrowserToolDef(
        "browser_ab_errors",
        ("errors",),
        "View page errors.",
        {
            "type": "object",
            "properties": {"clear": {"type": "boolean"}},
        },
        ("web.read",),
        lambda p: ["errors"] + (["--clear"] if p.get("clear") else []),
    ),
    AgentBrowserToolDef(
        "browser_ab_highlight",
        ("highlight",),
        "Highlight element (debug).",
        _sel_schema(required=["selector"]),
        ("web.read",),
        _build_simple("highlight", "selector"),
    ),
    AgentBrowserToolDef(
        "browser_ab_cookies",
        ("cookies",),
        "Manage cookies: get, set, or clear.",
        {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["get", "set", "clear"]},
                "url": {"type": "string"},
                "name": {"type": "string"},
                "value": {"type": "string"},
            },
            "required": ["action"],
        },
        ("web.read", "web.click"),
        _build_cookies,
    ),
    AgentBrowserToolDef(
        "browser_ab_storage",
        ("storage",),
        "Manage localStorage or sessionStorage.",
        {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["local", "session"]},
                "action": {"type": "string"},
                "key": {"type": "string"},
                "value": {"type": "string"},
            },
        },
        ("web.read", "web.click"),
        _build_storage,
    ),
    AgentBrowserToolDef(
        "browser_ab_trace",
        ("trace",),
        "Record Playwright trace (start/stop).",
        {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["start", "stop"]},
                "path": {"type": "string"},
            },
            "required": ["action"],
        },
        ("web.read",),
        _build_trace,
    ),
    AgentBrowserToolDef(
        "browser_ab_record",
        ("record",),
        "Record video (WebM) of session.",
        {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["start", "stop"]},
                "path": {"type": "string"},
                "url": {"type": "string"},
            },
            "required": ["action"],
        },
        ("web.read",),
        _build_record,
    ),
    AgentBrowserToolDef(
        "browser_ab_session",
        ("session",),
        "Show or list agent-browser sessions.",
        {
            "type": "object",
            "properties": {
                "list": {"type": "boolean", "description": "If true, session list."},
            },
        },
        ("web.read",),
        lambda p: ["session", "list"] if p.get("list") else ["session"],
    ),
    AgentBrowserToolDef(
        "browser_ab_connect",
        ("connect",),
        "Connect to browser via CDP port or URL.",
        {
            "type": "object",
            "properties": {"target": {"type": "string"}},
            "required": ["target"],
        },
        ("web.read", "web.click"),
        lambda p: ["connect", str(p["target"]).strip()],
    ),
    AgentBrowserToolDef(
        "browser_ab_close",
        ("close",),
        "Close browser session.",
        {"type": "object", "properties": {"all_sessions": {"type": "boolean"}}},
        ("web.read",),
        lambda p: ["close"] + (["--all"] if p.get("all_sessions") else []),
    ),
    AgentBrowserToolDef(
        "browser_exec",
        (),
        (
            "Run any allowed agent-browser CLI command. Pass argv as the command tokens after "
            "`agent-browser --json`, e.g. [\"find\", \"role\", \"button\", \"click\", \"--name\", \"Submit\"]. "
            "See agent-browser --help for full list. Prefer browser_ab_* tools when available."
        ),
        {
            "type": "object",
            "properties": {
                "argv": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "CLI tokens: [verb, ...args]",
                },
                "flags": {
                    "type": "object",
                    "description": "Optional flags as {full_page: true} -> --full-page",
                },
            },
            "required": ["argv"],
        },
        ("web.read",),
        _build_exec,
    ),
)
# fmt: on

AGENT_BROWSER_TOOL_IDS: tuple[str, ...] = tuple(d.tool_id for d in AGENT_BROWSER_TOOL_DEFS)
AGENT_BROWSER_TOOL_SCOPES: dict[str, tuple[str, ...]] = {d.tool_id: d.scopes for d in AGENT_BROWSER_TOOL_DEFS}


def tool_def_by_id(tool_id: str) -> AgentBrowserToolDef | None:
    for d in AGENT_BROWSER_TOOL_DEFS:
        if d.tool_id == tool_id:
            return d
    return None


def format_cli_result(payload: dict[str, Any], *, argv: list[str]) -> str:
    """Turn agent-browser JSON payload into LLM-readable text."""
    if payload.get("success"):
        data = payload.get("data")
        parts = [f"OK: agent-browser {' '.join(argv)}"]
        if isinstance(data, dict):
            snap = data.get("snapshot")
            if isinstance(snap, str) and snap.strip():
                parts.append(snap[:80_000])
            elif snap is not None:
                parts.append(json.dumps(snap, ensure_ascii=False)[:80_000])
            else:
                compact = json.dumps(data, ensure_ascii=False)
                if compact and compact != "{}":
                    parts.append(compact[:80_000])
        elif data is not None:
            parts.append(str(data)[:80_000])
        return "\n\n".join(parts)
    err = payload.get("error") or "unknown error"
    return f"[failed] agent-browser {' '.join(argv)}: {err}"


def maybe_check_ssrf_for_open(argv: list[str]) -> str | None:
    if not argv or argv[0] != "open":
        return None
    url = argv[1] if len(argv) > 1 else ""
    if not url.strip():
        return None
    try:
        from qlix.luna.security.ssrf import check_ssrf

        return check_ssrf(url)
    except ImportError:
        return None


_INTERACTIVE_CLI_ROOTS = frozenset(
    {
        "click",
        "dblclick",
        "type",
        "fill",
        "press",
        "hover",
        "focus",
        "check",
        "uncheck",
        "select",
        "drag",
        "upload",
        "download",
        "find",
        "mouse",
        "keyboard",
        "keydown",
        "keyup",
        "tap",
        "swipe",
    }
)


def run_agent_browser_tool(
    tool_id: str,
    params: dict[str, Any],
    *,
    granted_scopes: set[str] | None = None,
) -> tuple[bool, str]:
    """Execute a registered agent-browser Luna tool. Returns (success, content)."""
    from qlix.luna.browser.factory import browser_engine_name, get_browser_driver

    if browser_engine_name() not in ("agent_browser", "agent-browser", "agentbrowser"):
        return (
            False,
            "agent-browser tools require LUNA_BROWSER_ENGINE=agent_browser (cloud runner).",
        )

    defn = tool_def_by_id(tool_id)
    if defn is None:
        return False, f"Unknown agent-browser tool: {tool_id}"

    try:
        argv = defn.build_argv(params)
    except (ValueError, TypeError, KeyError) as exc:
        return False, f"Invalid parameters: {exc}"

    ssrf = maybe_check_ssrf_for_open(argv)
    if ssrf:
        return False, f"SSRF blocked: {ssrf}"

    if granted_scopes is not None:
        root = argv[0].lower()
        if root in _INTERACTIVE_CLI_ROOTS and "web.click" not in granted_scopes:
            return False, f"Denied: '{root}' requires web.click scope"
        if "web.read" not in granted_scopes:
            return False, "Denied: browser tools require web.read scope"

    driver = get_browser_driver()
    if not hasattr(driver, "run_cli"):
        return False, "Browser driver does not support agent-browser CLI."

    payload = driver.run_cli(argv)  # type: ignore[union-attr]
    content = format_cli_result(payload, argv=argv)
    return bool(payload.get("success")), content
