"""Cloud/hybrid runner: Google Drive / Calendar / Meet tools via Qlix backend proxy."""

from __future__ import annotations

import json
from typing import Any

import httpx

from .identity import AgentIdentity

GOOGLE_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "drive_read": ("drive.read", "drive.write"),
    "drive_write": ("drive.write",),
    "calendar_read": ("calendar.read", "calendar.write"),
    "calendar_write": ("calendar.write",),
    "meet_manage": ("meet.manage",),
}

# For drive_read / calendar_read, either read or write scope is enough.
_READ_ANY_OF = {
    "drive_read": ("drive.read", "drive.write"),
    "calendar_read": ("calendar.read", "calendar.write"),
}

GOOGLE_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "drive_read": {
        "type": "function",
        "function": {
            "name": "drive_read",
            "description": (
                "Read Google Drive or OneDrive. action='list' searches/lists files "
                "(optional query string); action='get' returns metadata for fileId; "
                "action='get_content' downloads file text content. "
                "When drive_provider_selection_required is returned, ask the user which listed drive "
                "to use and retry this operation with provider='google' or provider='microsoft'. "
                "Do not assume a provider and do not carry a prior choice to another operation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "get", "get_content"],
                    },
                    "provider": {
                        "type": "string",
                        "enum": ["google", "microsoft"],
                        "description": (
                            "Drive provider selected by the user when both Google Drive and OneDrive "
                            "are connected. google = Google Drive, microsoft = OneDrive."
                        ),
                    },
                    "query": {"type": "string", "description": "Search/list query for action=list."},
                    "fileId": {"type": "string"},
                    "pageSize": {"type": "integer"},
                    "pageToken": {"type": "string"},
                },
                "required": ["action"],
            },
        },
    },
    "drive_write": {
        "type": "function",
        "function": {
            "name": "drive_write",
            "description": (
                "Create, update, or delete files in Google Drive or OneDrive. "
                "action='create' needs name (+ optional contentText/mimeType/parentId); "
                "action='update' needs fileId (+ optional name/contentText); "
                "action='delete' needs fileId. "
                "Mutations may pause for one-time Approve/Deny in chat (JIT). "
                "When drive_provider_selection_required is returned, ask the user which listed drive "
                "to use and retry this operation with provider='google' or provider='microsoft'. "
                "Do not assume a provider and do not carry a prior choice to another operation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["create", "update", "delete"]},
                    "provider": {
                        "type": "string",
                        "enum": ["google", "microsoft"],
                        "description": (
                            "Drive provider selected by the user when both Google Drive and OneDrive "
                            "are connected. google = Google Drive, microsoft = OneDrive."
                        ),
                    },
                    "fileId": {"type": "string"},
                    "name": {"type": "string"},
                    "contentText": {"type": "string"},
                    "mimeType": {"type": "string"},
                    "parentId": {"type": "string"},
                },
                "required": ["action"],
            },
        },
    },
    "calendar_read": {
        "type": "function",
        "function": {
            "name": "calendar_read",
            "description": (
                "Read Google Calendar. action='list' lists upcoming events "
                "(optional timeMin/timeMax ISO-8601, query); "
                "action='get' fetches one event by eventId. "
                "Requires Calendar connected in Connectors → Google → Calendar."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "get"]},
                    "eventId": {"type": "string"},
                    "calendarId": {
                        "type": "string",
                        "description": "Defaults to primary.",
                    },
                    "timeMin": {"type": "string"},
                    "timeMax": {"type": "string"},
                    "query": {"type": "string"},
                    "maxResults": {"type": "integer"},
                },
                "required": ["action"],
            },
        },
    },
    "calendar_write": {
        "type": "function",
        "function": {
            "name": "calendar_write",
            "description": (
                "Create, update, or delete Google Calendar events. "
                "action='create' needs summary, start, end (ISO-8601 or YYYY-MM-DD for all-day); "
                "optional attendees, description, location; set createMeetLink=true to attach a Meet URL "
                "(also requires meet.manage). "
                "action='update'/'delete' need eventId. Mutations may require JIT approval."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["create", "update", "delete"]},
                    "eventId": {"type": "string"},
                    "calendarId": {"type": "string"},
                    "summary": {"type": "string"},
                    "description": {"type": "string"},
                    "location": {"type": "string"},
                    "start": {"type": "string"},
                    "end": {"type": "string"},
                    "attendees": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "createMeetLink": {"type": "boolean"},
                },
                "required": ["action"],
            },
        },
    },
    "meet_manage": {
        "type": "function",
        "function": {
            "name": "meet_manage",
            "description": (
                "Manage Google Meet spaces. action='create' makes a new meeting and returns meetingUri; "
                "action='get' loads a space by name (spaces/xxx); "
                "action='end' ends the active conference for that space. "
                "create/end may require JIT approval. Prefer calendar_write createMeetLink=true "
                "when scheduling a calendar event with a Meet link."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["create", "get", "end"]},
                    "name": {
                        "type": "string",
                        "description": "Space resource name for get/end, e.g. spaces/abc-defg-hij.",
                    },
                },
                "required": ["action"],
            },
        },
    },
}

_JIT_TOOLS = {
    "drive_write": "drive.write",
    "calendar_write": "calendar.write",
    "meet_manage": "meet.manage",
}


def _granted(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def _tool_allowed(identity: AgentIdentity, tool_id: str) -> bool:
    granted = _granted(identity)
    any_of = _READ_ANY_OF.get(tool_id)
    if any_of:
        return any(s in granted for s in any_of)
    req = GOOGLE_TOOL_SCOPES.get(tool_id, ())
    return all(s in granted for s in req)


def _needs_jit(identity: AgentIdentity, action_type: str) -> bool:
    return action_type in set(identity.jit_scopes) and action_type not in set(identity.always_scopes)


def openai_google_workspace_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    tool_ids = list(GOOGLE_TOOL_SCOPES.keys())
    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [
                t
                for t in tool_ids
                if any(s in filt for s in GOOGLE_TOOL_SCOPES.get(t, ()))
                or any(s in filt for s in _READ_ANY_OF.get(t, ()))
            ]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        if not _tool_allowed(identity, tid):
            continue
        defn = GOOGLE_TOOL_DEFINITIONS.get(tid)
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
        return f"[failed] Google workspace tool request error: {exc}"

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
            if code == "drive_provider_selection_required":
                providers = err.get("providers")
                if isinstance(providers, list):
                    labels = [
                        f'{item.get("id")}: {item.get("label")}'
                        for item in providers
                        if isinstance(item, dict) and item.get("id") and item.get("label")
                    ]
                    if labels:
                        return (
                            f"[failed] {code}: {message}\n"
                            f"Available drives: {'; '.join(labels)}. "
                            "Ask the user which drive to use (Google Drive or OneDrive), "
                            "then retry with its provider id (provider='google' or provider='microsoft')."
                        )
                return f"[failed] {code}: {message}"
            return f"[failed] {code}: {message}"
        return f"[failed] HTTP {resp.status_code}: {text[:500]}"

    return json.dumps(data, ensure_ascii=False)


def build_google_workspace_tool_executors(
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
    defs = openai_google_workspace_tool_definitions(identity, skill_filter)
    allowed = {d["function"]["name"] for d in defs if isinstance(d.get("function"), dict)}

    async def _maybe_jit(tool_name: str, action: str, payload: dict[str, Any]) -> str | None:
        action_type = _JIT_TOOLS.get(tool_name)
        if not action_type:
            return None
        # meet get is non-mutating
        if tool_name == "meet_manage" and action == "get":
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

    if "drive_read" in allowed:

        def _drive_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            body: dict[str, Any] = {"runId": run_id, "action": params.get("action") or "list"}
            for key in ("provider", "query", "fileId", "pageSize", "pageToken"):
                if params.get(key) is not None:
                    body[key] = params[key]
            return _post(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/drive/read",
                body=body,
            )

        executors["drive_read"] = _drive_read

    if "drive_write" in allowed:

        async def _drive_write(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            action = str(params.get("action") or "create")
            body: dict[str, Any] = {"runId": run_id, "action": action}
            for key in ("provider", "fileId", "name", "contentText", "mimeType", "parentId"):
                if params.get(key) is not None:
                    body[key] = params[key]
            try:
                jit = await _maybe_jit("drive_write", action, {"action": action, "name": body.get("name")})
            except RuntimeError as exc:
                return f"[failed] {exc}"
            if jit:
                body["jitToken"] = jit
            return _post(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/drive/write",
                body=body,
            )

        executors["drive_write"] = _drive_write

    if "calendar_read" in allowed:

        def _calendar_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            body: dict[str, Any] = {"runId": run_id, "action": params.get("action") or "list"}
            for key in ("eventId", "calendarId", "timeMin", "timeMax", "query", "maxResults"):
                if params.get(key) is not None:
                    body[key] = params[key]
            return _post(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/calendar/read",
                body=body,
            )

        executors["calendar_read"] = _calendar_read

    if "calendar_write" in allowed:

        async def _calendar_write(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            action = str(params.get("action") or "create")
            body: dict[str, Any] = {"runId": run_id, "action": action}
            for key in (
                "eventId",
                "calendarId",
                "summary",
                "description",
                "location",
                "start",
                "end",
                "attendees",
                "createMeetLink",
            ):
                if params.get(key) is not None:
                    body[key] = params[key]
            try:
                jit = await _maybe_jit(
                    "calendar_write",
                    action,
                    {"action": action, "summary": body.get("summary")},
                )
            except RuntimeError as exc:
                return f"[failed] {exc}"
            if jit:
                body["jitToken"] = jit
            return _post(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/calendar/write",
                body=body,
            )

        executors["calendar_write"] = _calendar_write

    if "meet_manage" in allowed:

        async def _meet_manage(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            action = str(params.get("action") or "create")
            body: dict[str, Any] = {"runId": run_id, "action": action}
            if params.get("name") is not None:
                body["name"] = params["name"]
            try:
                jit = await _maybe_jit("meet_manage", action, {"action": action, "name": body.get("name")})
            except RuntimeError as exc:
                return f"[failed] {exc}"
            if jit:
                body["jitToken"] = jit
            return _post(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/meet/manage",
                body=body,
            )

        executors["meet_manage"] = _meet_manage

    return executors


def is_google_workspace_tool(tool_name: str) -> bool:
    return tool_name in GOOGLE_TOOL_SCOPES
