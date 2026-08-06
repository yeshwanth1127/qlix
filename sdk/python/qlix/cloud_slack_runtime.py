"""Cloud runner: Slack tools via Qlix backend proxy (user OAuth token)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from .identity import AgentIdentity

SLACK_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "slack_list_channels": ("slack.read",),
    "slack_list_users": ("slack.read",),
    "slack_search_messages": ("slack.read",),
    "slack_get_history": ("slack.read",),
    "slack_describe_list": ("slack.read",),
    "slack_find_channel_lists": ("slack.read",),
    "slack_list_list_items": ("slack.read",),
    "slack_post_message": ("slack.send",),
    "slack_create_channel": ("slack.send",),
    "slack_set_channel_topic": ("slack.send",),
    "slack_open_dm": ("slack.send",),
    "slack_set_presence": ("slack.send",),
    "slack_create_list_item": ("slack.send",),
    "slack_update_list_item": ("slack.send",),
    "slack_delete_list_item": ("slack.send",),
    "slack_set_list_task_completion": ("slack.send",),
}

JIT_SCOPES_BY_TOOL: dict[str, str] = {
    "slack_post_message": "slack.send",
    "slack_create_channel": "slack.send",
    "slack_set_channel_topic": "slack.send",
    "slack_open_dm": "slack.send",
    "slack_set_presence": "slack.send",
    "slack_create_list_item": "slack.send",
    "slack_update_list_item": "slack.send",
    "slack_delete_list_item": "slack.send",
    "slack_set_list_task_completion": "slack.send",
}

SLACK_TOOL_PATHS: dict[str, str] = {
    "slack_list_channels": "channels",
    "slack_list_users": "users",
    "slack_search_messages": "search",
    "slack_get_history": "history",
    "slack_describe_list": "describe-list",
    "slack_find_channel_lists": "find-channel-lists",
    "slack_list_list_items": "list-items",
    "slack_post_message": "post",
    "slack_create_channel": "create-channel",
    "slack_set_channel_topic": "set-topic",
    "slack_open_dm": "open-dm",
    "slack_set_presence": "set-presence",
    "slack_create_list_item": "create-list-item",
    "slack_update_list_item": "update-list-item",
    "slack_delete_list_item": "delete-list-item",
    "slack_set_list_task_completion": "set-list-task-completion",
}

SLACK_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "slack_list_channels": {
        "type": "function",
        "function": {
            "name": "slack_list_channels",
            "description": (
                "List Slack channels the connected user can access. "
                "Use before posting when you need a channel id (starts with C or G)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "types": {
                        "type": "string",
                        "description": "Slack types filter, e.g. public_channel,private_channel",
                    },
                    "limit": {"type": "integer", "description": "Max channels (default 200)."},
                },
            },
        },
    },
    "slack_search_messages": {
        "type": "function",
        "function": {
            "name": "slack_search_messages",
            "description": "Search Slack messages across the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Slack search query."},
                    "count": {"type": "integer", "description": "Max results (default 20)."},
                },
                "required": ["query"],
            },
        },
    },
    "slack_get_history": {
        "type": "function",
        "function": {
            "name": "slack_get_history",
            "description": "Read recent messages from a Slack channel or DM by channel id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "Channel id (C… or G… or D…)."},
                    "limit": {"type": "integer"},
                    "oldest": {"type": "string", "description": "Oldest message ts."},
                    "latest": {"type": "string", "description": "Latest message ts."},
                },
                "required": ["channel"],
            },
        },
    },
    "slack_post_message": {
        "type": "function",
        "function": {
            "name": "slack_post_message",
            "description": (
                "Post a chat message to a Slack channel or DM as the connected Slack user. "
                "Use only when the user explicitly asks to send, post, or reply to chat; "
                "use slack_create_list_item for project-tracker tasks. "
                "Requires slack.send scope and user approval when JIT is enabled."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "Channel name (#todo) or id to post in."},
                    "text": {"type": "string", "description": "Message text (mrkdwn supported)."},
                    "threadTs": {
                        "type": "string",
                        "description": "Optional thread timestamp to reply in a thread.",
                    },
                },
                "required": ["channel", "text"],
            },
        },
    },
    "slack_list_users": {
        "type": "function",
        "function": {
            "name": "slack_list_users",
            "description": "List workspace members (use slack_open_dm with a user id to start a DM).",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer"},
                    "cursor": {"type": "string", "description": "Pagination cursor from a prior call."},
                },
            },
        },
    },
    "slack_create_channel": {
        "type": "function",
        "function": {
            "name": "slack_create_channel",
            "description": "Create a public or private Slack channel on behalf of the connected user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Channel name without #."},
                    "isPrivate": {"type": "boolean", "description": "True for a private channel."},
                },
                "required": ["name"],
            },
        },
    },
    "slack_set_channel_topic": {
        "type": "function",
        "function": {
            "name": "slack_set_channel_topic",
            "description": "Set the topic/description of a Slack channel.",
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "Channel id."},
                    "topic": {"type": "string", "description": "New channel topic."},
                },
                "required": ["channel", "topic"],
            },
        },
    },
    "slack_open_dm": {
        "type": "function",
        "function": {
            "name": "slack_open_dm",
            "description": "Open a direct message with a workspace member; returns channel id for slack_post_message.",
            "parameters": {
                "type": "object",
                "properties": {
                    "userId": {"type": "string", "description": "Slack user id (U…)."},
                },
                "required": ["userId"],
            },
        },
    },
    "slack_set_presence": {
        "type": "function",
        "function": {
            "name": "slack_set_presence",
            "description": "Set the connected user's Slack presence to active (auto) or away.",
            "parameters": {
                "type": "object",
                "properties": {
                    "presence": {"type": "string", "enum": ["auto", "away"]},
                },
                "required": ["presence"],
            },
        },
    },
    "slack_describe_list": {
        "type": "function",
        "function": {
            "name": "slack_describe_list",
            "description": (
                "Describe a Slack List (project tracker). Prefer channel (#todo) — Qlix resolves the List id (F…). "
                "Do not pass channel ids (C…) or guessed F ids as listId."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "Channel name (#todo) or id — preferred."},
                    "listId": {"type": "string", "description": "Slack List id (F…) only if already known."},
                    "listTitle": {"type": "string", "description": "Optional list/tab title filter."},
                },
            },
        },
    },
    "slack_find_channel_lists": {
        "type": "function",
        "function": {
            "name": "slack_find_channel_lists",
            "description": (
                "Find Slack Lists attached to a channel (project tracker / List tab). "
                "Returns list ids (F…) — use these with slack_create_list_item, not the channel id (C…). "
                "Do not use slack_post_message for tracker tasks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {
                        "type": "string",
                        "description": "Channel name (#todo) or id (C…).",
                    },
                    "listTitle": {
                        "type": "string",
                        "description": "Optional list/tab title to pick (e.g. Project tracker).",
                    },
                },
                "required": ["channel"],
            },
        },
    },
    "slack_list_list_items": {
        "type": "function",
        "function": {
            "name": "slack_list_list_items",
            "description": "List or search tasks in a channel project tracker / Slack List, never channel messages.",
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "Channel name (#todo) or id — preferred."},
                    "listId": {"type": "string", "description": "Slack List id (F…) if already known."},
                    "listTitle": {"type": "string", "description": "Optional tracker/list title filter."},
                    "query": {"type": "string", "description": "Optional task-title search."},
                    "status": {"type": "string", "description": "Optional status label filter."},
                    "completed": {"type": "boolean", "description": "Optional completion-state filter."},
                    "limit": {"type": "integer"},
                    "cursor": {"type": "string"},
                },
            },
        },
    },
    "slack_create_list_item": {
        "type": "function",
        "function": {
            "name": "slack_create_list_item",
            "description": (
                "Add a task row to a channel project tracker / Slack List — not a chat message. "
                "Always pass channel (#todo). Never guess listId; omit listId unless returned by slack_find_channel_lists."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {
                        "type": "string",
                        "description": "Channel name (#todo) or id — required for project tracker tasks.",
                    },
                    "listId": {"type": "string", "description": "Only use when copied from slack_find_channel_lists."},
                    "listTitle": {
                        "type": "string",
                        "description": "Optional list/tab title when a channel has multiple lists.",
                    },
                    "title": {"type": "string", "description": "Task title / primary column text."},
                    "status": {"type": "string", "description": "Optional Status label, e.g. In progress."},
                    "assigneeUserId": {"type": "string", "description": "Optional Slack user id (U…)."},
                    "dueDate": {"type": "string", "description": "Optional due date YYYY-MM-DD."},
                    "completed": {"type": "boolean", "description": "Mark completed on create."},
                },
                "required": ["channel", "title"],
            },
        },
    },
    "slack_update_list_item": {
        "type": "function",
        "function": {
            "name": "slack_update_list_item",
            "description": (
                "Update a project tracker task row. Pass channel (#todo) and taskTitle (task name). "
                "Use status for Status column (e.g. In progress, Done). "
                "Do not guess listId or use taskTitle as itemId — item ids start with Rec."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "Channel name (#todo) or id."},
                    "taskTitle": {
                        "type": "string",
                        "description": "Existing task name to find the row (e.g. yeshwanth).",
                    },
                    "itemId": {"type": "string", "description": "Row id (Rec…) if returned from create."},
                    "listTitle": {"type": "string", "description": "Optional list/tab title filter."},
                    "listId": {"type": "string", "description": "Only if copied from slack_find_channel_lists."},
                    "status": {
                        "type": "string",
                        "description": "Status label: Not started, In progress, Blocked, Done.",
                    },
                    "title": {"type": "string", "description": "Rename the task (primary column)."},
                    "assigneeUserId": {"type": "string"},
                    "dueDate": {"type": "string", "description": "YYYY-MM-DD"},
                    "completed": {"type": "boolean"},
                },
                "required": ["channel", "taskTitle"],
            },
        },
    },
    "slack_delete_list_item": {
        "type": "function",
        "function": {
            "name": "slack_delete_list_item",
            "description": (
                "Permanently delete a project-tracker task only after the user explicitly asked to delete it. "
                "Pass channel plus taskTitle; never delete a chat message."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "Channel name (#todo) or id."},
                    "taskTitle": {"type": "string", "description": "Exact task title to delete."},
                    "itemId": {"type": "string", "description": "Row id (Rec…) if known."},
                    "listTitle": {"type": "string", "description": "Optional tracker/list title filter."},
                    "listId": {"type": "string", "description": "Only if copied from Slack tool output."},
                },
                "required": ["channel", "taskTitle"],
            },
        },
    },
    "slack_set_list_task_completion": {
        "type": "function",
        "function": {
            "name": "slack_set_list_task_completion",
            "description": "Complete or reopen a project-tracker task. Pass channel and taskTitle.",
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "Channel name (#todo) or id."},
                    "taskTitle": {"type": "string", "description": "Exact existing task title."},
                    "itemId": {"type": "string", "description": "Row id (Rec…) if known."},
                    "listTitle": {"type": "string", "description": "Optional tracker/list title filter."},
                    "listId": {"type": "string", "description": "Only if copied from Slack tool output."},
                    "completed": {"type": "boolean", "description": "True to complete; false to reopen."},
                },
                "required": ["channel", "taskTitle", "completed"],
            },
        },
    },
}


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(getattr(identity, "permission_scopes", []) or []) | set(
        getattr(identity, "always_scopes", []) or []
    )


def _slack_scope_needs_jit(identity: AgentIdentity, scope: str) -> bool:
    jit_scopes = set(getattr(identity, "jit_scopes", []) or [])
    always = set(getattr(identity, "always_scopes", []) or [])
    return scope in jit_scopes and scope not in always


def openai_slack_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    granted = _effective_granted_scopes(identity)
    tool_ids = list(SLACK_TOOL_SCOPES.keys())

    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [t for t in tool_ids if any(s in filt for s in SLACK_TOOL_SCOPES.get(t, ()))]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = SLACK_TOOL_SCOPES.get(tid, ())
        if any(s not in granted for s in req):
            continue
        defn = SLACK_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def _post_slack_tool(
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
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(url, headers=headers, json=body)
    except Exception as exc:
        return f"[failed] Slack tool request error: {exc}"

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


def build_slack_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
    qlix_sdk: Any = None,
) -> dict[str, callable]:
    executors: dict[str, callable] = {}
    defs = openai_slack_tool_definitions(identity, skill_filter)
    allowed = {d["function"]["name"] for d in defs if isinstance(d.get("function"), dict)}
    jit_locks: dict[str, asyncio.Lock] = {}
    jit_granted_scopes: set[str] = set()

    async def _ensure_jit(scope: str, tool: str, params: dict[str, Any]) -> str | None:
        if scope in jit_granted_scopes:
            return None
        lock = jit_locks.setdefault(scope, asyncio.Lock())
        async with lock:
            if scope in jit_granted_scopes:
                return None
            jit_payload = {
                "runId": run_id,
                "tool": tool,
                **{k: params.get(k) for k in ("channel", "text")},
            }
            try:
                from .jit import request_jit_via_runner

                approval = await request_jit_via_runner(
                    agent_id=agent_id,
                    runner_token=runner_token,
                    backend_url=backend_url,
                    did=identity.did,
                    private_key_hex=identity.private_key_hex,
                    action_type=scope,
                    payload=jit_payload,
                    qlix_sdk=qlix_sdk,
                )
            except Exception as exc:
                raise RuntimeError(str(exc)) from exc
            jit_granted_scopes.add(scope)
            return getattr(approval, "jit_token", None)

    async def _run(tool: str, args_json: str) -> str:
        params = json.loads(args_json) if args_json.strip() else {}
        if not isinstance(params, dict):
            params = {}
        body: dict[str, Any] = {"runId": run_id, **params}

        jit_scope = JIT_SCOPES_BY_TOOL.get(tool)
        jit_token = params.get("jitToken")
        if jit_scope and _slack_scope_needs_jit(identity, jit_scope) and not jit_token:
            try:
                jit_token = await _ensure_jit(jit_scope, tool, params)
            except Exception as exc:  # noqa: BLE001
                return f"[failed] JIT approval not granted: {exc}"
        if jit_token:
            body["jitToken"] = jit_token

        path_suffix = SLACK_TOOL_PATHS.get(tool, tool.replace("_", "-"))
        return _post_slack_tool(
            backend_url=backend_url,
            runner_token=runner_token,
            agent_id=agent_id,
            path=f"/api/v1/agents/{agent_id}/tools/slack/{path_suffix}",
            body=body,
        )

    for tool in allowed:

        def _factory(tool_name: str):
            async def _execute(args_json: str) -> str:
                return await _run(tool_name, args_json)

            return _execute

        executors[tool] = _factory(tool)

    return executors
