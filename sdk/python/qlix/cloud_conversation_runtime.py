"""Outreach conversation tools: start, list, get, send, and close parallel threads."""

from __future__ import annotations

import json
from typing import Any

import httpx

from .identity import AgentIdentity

CONVERSATION_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "conversation_start": ("conversation",),
    "conversation_list": ("conversation",),
    "conversation_get": ("conversation",),
    "conversation_send": ("conversation",),
    "conversation_close": ("conversation",),
}

CONVERSATION_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "conversation_start": {
        "type": "function",
        "function": {
            "name": "conversation_start",
            "description": (
                "Start one or many parallel conversation threads on a channel (WhatsApp today). "
                "Each recipient gets a separate thread so replies stay isolated. "
                "Optional opening content is sent on the thread. "
                "Requires the conversation capability (Outreach plugin). "
                "WhatsApp send still needs whatsapp.contact_send when delivering an opening message."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {
                        "type": "string",
                        "description": "Channel id, e.g. whatsapp.",
                    },
                    "recipient": {
                        "type": "string",
                        "description": "One contact address (phone, jid, or channel id).",
                    },
                    "recipients": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Multiple recipients to start in parallel.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Optional opening message. Omit to listen only.",
                    },
                    "processId": {
                        "type": "string",
                        "description": "Optional existing conversation process to attach threads to.",
                    },
                },
            },
        },
    },
    "conversation_list": {
        "type": "function",
        "function": {
            "name": "conversation_list",
            "description": (
                "List conversation threads for this campaign or run, with status and last inbound/outbound."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "processId": {
                        "type": "string",
                        "description": "Optional process id. Defaults to this run's process.",
                    },
                },
            },
        },
    },
    "conversation_get": {
        "type": "function",
        "function": {
            "name": "conversation_get",
            "description": "Get one conversation thread and its event history.",
            "parameters": {
                "type": "object",
                "properties": {
                    "threadId": {
                        "type": "string",
                        "description": "Conversation thread id from conversation_start or conversation_list.",
                    },
                },
                "required": ["threadId"],
            },
        },
    },
    "conversation_send": {
        "type": "function",
        "function": {
            "name": "conversation_send",
            "description": (
                "Send a follow-up message on an existing conversation thread. "
                "Uses that thread's channel (WhatsApp maps to whatsapp.contact_send JIT)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "threadId": {"type": "string", "description": "Conversation thread id."},
                    "content": {"type": "string", "description": "Message to send."},
                },
                "required": ["threadId", "content"],
            },
        },
    },
    "conversation_close": {
        "type": "function",
        "function": {
            "name": "conversation_close",
            "description": "Close a conversation thread so new replies no longer attach to it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "threadId": {"type": "string", "description": "Conversation thread id."},
                    "reason": {"type": "string", "description": "Optional close reason."},
                },
                "required": ["threadId"],
            },
        },
    },
}


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    granted = set(identity.permission_scopes) | set(identity.always_scopes)
    if "whatsapp.auto_reply" in granted:
        granted.add("conversation")
    return granted


def openai_conversation_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    granted = _effective_granted_scopes(identity)
    tool_ids = list(CONVERSATION_TOOL_SCOPES.keys())
    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [
                t
                for t in tool_ids
                if any(s in filt for s in CONVERSATION_TOOL_SCOPES.get(t, ()))
            ]
        else:
            tool_ids = [t for t in tool_ids if t in filt]
    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = CONVERSATION_TOOL_SCOPES.get(tid, ())
        if any(s not in granted for s in req):
            continue
        defn = CONVERSATION_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def _post_json(
    *,
    backend_url: str,
    runner_token: str,
    agent_id: str,
    path: str,
    body: dict[str, Any],
) -> str:
    url = backend_url.rstrip("/") + path
    try:
        response = httpx.post(
            url,
            json=body,
            headers={"Authorization": f"Bearer {runner_token}"},
            timeout=60.0,
        )
    except httpx.HTTPError as exc:
        return f"[failed] conversation tool request failed: {exc}"
    if response.status_code >= 400:
        try:
            payload = response.json()
            message = payload.get("error", {}).get("message") or payload.get("message") or response.text
        except Exception:
            message = response.text
        return f"[failed] {message}"
    try:
        return json.dumps(response.json(), ensure_ascii=False)
    except Exception:
        return response.text or "[ok]"


def build_conversation_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
) -> dict[str, callable]:
    executors: dict[str, callable] = {}
    allowed = {
        item["function"]["name"]
        for item in openai_conversation_tool_definitions(identity, skill_filter)
        if isinstance(item.get("function"), dict)
    }

    def _call(action: str, extra: dict[str, Any]) -> str:
        return _post_json(
            backend_url=backend_url,
            runner_token=runner_token,
            agent_id=agent_id,
            path=f"/api/v1/agents/{agent_id}/tools/conversation/{action}",
            body={"runId": run_id, **extra},
        )

    if "conversation_start" in allowed:

        def _start(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            body: dict[str, Any] = {"channel": str(params.get("channel") or "whatsapp")}
            if params.get("recipient"):
                body["recipient"] = str(params["recipient"])
            if isinstance(params.get("recipients"), list):
                body["recipients"] = [str(item) for item in params["recipients"] if str(item).strip()]
            if params.get("content"):
                body["content"] = str(params["content"])
            if params.get("processId"):
                body["processId"] = str(params["processId"])
            return _call("start", body)

        executors["conversation_start"] = _start

    if "conversation_list" in allowed:

        def _list(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            body: dict[str, Any] = {}
            if isinstance(params, dict) and params.get("processId"):
                body["processId"] = str(params["processId"])
            return _call("list", body)

        executors["conversation_list"] = _list

    if "conversation_get" in allowed:

        def _get(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            thread_id = str(params.get("threadId", "")).strip() if isinstance(params, dict) else ""
            if not thread_id:
                return "[failed] threadId is required"
            return _call("get", {"threadId": thread_id})

        executors["conversation_get"] = _get

    if "conversation_send" in allowed:

        def _send(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            thread_id = str(params.get("threadId", "")).strip()
            content = str(params.get("content", "")).strip()
            if not thread_id:
                return "[failed] threadId is required"
            if not content:
                return "[failed] content is required"
            return _call("send", {"threadId": thread_id, "content": content})

        executors["conversation_send"] = _send

    if "conversation_close" in allowed:

        def _close(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            thread_id = str(params.get("threadId", "")).strip()
            if not thread_id:
                return "[failed] threadId is required"
            body: dict[str, Any] = {"threadId": thread_id}
            if params.get("reason"):
                body["reason"] = str(params["reason"])
            return _call("close", body)

        executors["conversation_close"] = _close

    return executors
