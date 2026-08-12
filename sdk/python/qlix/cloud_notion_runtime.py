"""Cloud/hybrid runner: Notion tools via Qlix backend proxy."""

from __future__ import annotations

import json
from typing import Any

import httpx

from .identity import AgentIdentity

NOTION_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "notion_read": ("notion.read", "notion.write"),
    "notion_write": ("notion.write",),
}

_READ_ANY_OF = {
    "notion_read": ("notion.read", "notion.write"),
}

_JIT_TOOLS: dict[str, str] = {
    "notion_write": "notion.write",
}

NOTION_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "notion_read": {
        "type": "function",
        "function": {
            "name": "notion_read",
            "description": (
                "Read from the connected Notion workspace. "
                "action='search' finds pages/databases (optional query, filter='page'|'database'); "
                "action='get_page' returns page metadata + markdown content for pageId; "
                "action='query_database' lists rows in databaseId (optional filterJson/sorts). "
                "Requires Connectors → Notion."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["search", "get_page", "query_database"],
                    },
                    "query": {"type": "string", "description": "Search query for action=search."},
                    "filter": {
                        "type": "string",
                        "enum": ["page", "database"],
                        "description": "Optional object filter for action=search.",
                    },
                    "pageId": {"type": "string", "description": "Page id for action=get_page."},
                    "databaseId": {
                        "type": "string",
                        "description": "Database id for action=query_database.",
                    },
                    "pageSize": {"type": "integer"},
                    "startCursor": {"type": "string"},
                    "filterJson": {
                        "type": "object",
                        "description": "Notion database query filter object.",
                    },
                    "sorts": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "Notion database query sorts.",
                    },
                },
                "required": ["action"],
            },
        },
    },
    "notion_write": {
        "type": "function",
        "function": {
            "name": "notion_write",
            "description": (
                "Create or update Notion content. "
                "action='create_page' needs title + parentPageId or parentDatabaseId "
                "(+ optional contentMarkdown/properties); "
                "action='update_page' needs pageId + contentMarkdown and/or title "
                "(appends markdown blocks); "
                "action='create_database_row' needs databaseId (+ title/properties/contentMarkdown). "
                "Pass page body as markdown — it is converted to Notion blocks. "
                "Mutations may pause for Approve/Deny in chat (JIT)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create_page", "update_page", "create_database_row"],
                    },
                    "pageId": {"type": "string"},
                    "parentPageId": {"type": "string"},
                    "parentDatabaseId": {"type": "string"},
                    "databaseId": {"type": "string"},
                    "title": {"type": "string"},
                    "contentMarkdown": {
                        "type": "string",
                        "description": "Markdown / plain text converted to Notion blocks.",
                    },
                    "properties": {
                        "type": "object",
                        "description": (
                            "Database/page properties. Flat string/number/boolean values "
                            "are coerced; Notion-shaped property objects are passed through."
                        ),
                    },
                },
                "required": ["action"],
            },
        },
    },
}


def _granted(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def _tool_allowed(identity: AgentIdentity, tool_id: str) -> bool:
    granted = _granted(identity)
    any_of = _READ_ANY_OF.get(tool_id)
    if any_of:
        return any(s in granted for s in any_of)
    req = NOTION_TOOL_SCOPES.get(tool_id, ())
    return all(s in granted for s in req)


def _needs_jit(identity: AgentIdentity, action_type: str) -> bool:
    return action_type in set(identity.jit_scopes) and action_type not in set(identity.always_scopes)


def openai_notion_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    tool_ids = list(NOTION_TOOL_SCOPES.keys())
    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [
                t
                for t in tool_ids
                if any(s in filt for s in NOTION_TOOL_SCOPES.get(t, ()))
                or any(s in filt for s in _READ_ANY_OF.get(t, ()))
            ]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        if not _tool_allowed(identity, tid):
            continue
        defn = NOTION_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def _post(
    *,
    backend_url: str,
    runner_token: str,
    agent_id: str,
    path: str,
    body: dict[str, Any],
) -> str:
    url = f"{backend_url.rstrip('/')}{path}"
    headers = {"X-QLIX-Runner-Token": runner_token, "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, json=body)
    except Exception as exc:  # noqa: BLE001
        return f"[failed] Notion tool request error: {exc}"

    text = resp.text
    try:
        data = resp.json() if text else {}
    except json.JSONDecodeError:
        data = {"raw": text[:4000]}

    if resp.status_code >= 400:
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict):
            code = err.get("code", "error")
            message = err.get("message", text[:500])
            instructions = err.get("connectInstructions")
            if instructions and code == "connector_not_configured":
                return f"[failed] {code}: {message}\n\n{instructions}"
            return f"[failed] {code}: {message}"
        return f"[failed] HTTP {resp.status_code}: {text[:500]}"

    return json.dumps(data, ensure_ascii=False)


def build_notion_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
    qlix_sdk: Any = None,
) -> dict[str, Any]:
    executors: dict[str, Any] = {}
    defs = openai_notion_tool_definitions(identity, skill_filter)
    allowed = {d["function"]["name"] for d in defs if isinstance(d.get("function"), dict)}

    async def _maybe_jit(tool_name: str, payload: dict[str, Any]) -> str | None:
        action_type = _JIT_TOOLS.get(tool_name)
        if not action_type:
            return None
        if not _needs_jit(identity, action_type):
            return None
        try:
            from .jit import request_jit_via_runner

            approval = await request_jit_via_runner(
                agent_id=agent_id,
                runner_token=runner_token,
                backend_url=backend_url,
                did=identity.did,
                private_key_hex=identity.private_key_hex,
                action_type=action_type,
                payload={"runId": run_id, "tool": tool_name, **payload},
                qlix_sdk=qlix_sdk,
            )
            return getattr(approval, "jit_token", None)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"JIT approval not granted: {exc}") from exc

    if "notion_read" in allowed:

        def _notion_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            body: dict[str, Any] = {"runId": run_id, "action": params.get("action") or "search"}
            for key in (
                "query",
                "filter",
                "pageId",
                "databaseId",
                "pageSize",
                "startCursor",
                "filterJson",
                "sorts",
            ):
                if params.get(key) is not None:
                    body[key] = params[key]
            return _post(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/notion/read",
                body=body,
            )

        executors["notion_read"] = _notion_read

    if "notion_write" in allowed:

        async def _notion_write(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            action = str(params.get("action") or "create_page")
            body: dict[str, Any] = {"runId": run_id, "action": action}
            for key in (
                "pageId",
                "parentPageId",
                "parentDatabaseId",
                "databaseId",
                "title",
                "contentMarkdown",
                "properties",
            ):
                if params.get(key) is not None:
                    body[key] = params[key]
            try:
                jit = await _maybe_jit(
                    "notion_write",
                    {"action": action, "title": body.get("title"), "pageId": body.get("pageId")},
                )
            except RuntimeError as exc:
                return f"[failed] {exc}"
            if jit:
                body["jitToken"] = jit
            return _post(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/notion/write",
                body=body,
            )

        executors["notion_write"] = _notion_write

    return executors
