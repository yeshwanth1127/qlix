"""Comms tools (cloud + hybrid): WhatsApp self-delivery + contact messaging/reading.

- ``whatsapp_send``: upload a runner-local file to the user's linked WhatsApp self-chat.
- ``whatsapp_list_contacts`` / ``whatsapp_read_chat``: phonebook + recent 1:1 messages (scope whatsapp.read).
- ``whatsapp_send_message``: text a contact/phone (scope whatsapp.contact_send, JIT-gated).

Only use contact tools when the user explicitly asks.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import httpx

from .identity import AgentIdentity

WHATSAPP_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "whatsapp_send": ("whatsapp.send",),
    "whatsapp_list_contacts": ("whatsapp.read", "whatsapp.contact_send"),
    "whatsapp_read_chat": ("whatsapp.read",),
    "whatsapp_send_message": ("whatsapp.contact_send",),
    "whatsapp_auto_reply_status": ("whatsapp.auto_reply",),
    "whatsapp_auto_reply_stop": ("whatsapp.auto_reply",),
    "whatsapp_auto_reply_set_instructions": ("whatsapp.auto_reply",),
}

# Upload cap (decoded bytes). WhatsApp documents are typically small (PDFs,
# screenshots); keep this well under the backend's base64 body limit.
_MAX_FILE_BYTES = 20_000_000

WHATSAPP_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "whatsapp_send": {
        "type": "function",
        "function": {
            "name": "whatsapp_send",
            "description": (
                "Send a file (PDF, image, screenshot, document) produced during this run to "
                "the user's linked WhatsApp self-chat (Message yourself). Not for messaging "
                "other contacts — use whatsapp_send_message for that. "
                "Requires the whatsapp.send scope."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Absolute path to the file in the runner.",
                    },
                    "file_name": {
                        "type": "string",
                        "description": "Optional display name shown in WhatsApp (defaults to the file's name).",
                    },
                },
                "required": ["file_path"],
            },
        },
    },
    "whatsapp_list_contacts": {
        "type": "function",
        "function": {
            "name": "whatsapp_list_contacts",
            "description": (
                "Search the user's WhatsApp phonebook/contacts by name or phone. "
                "Use only when the user asks about contacts or who to message. "
                "Requires whatsapp.read or whatsapp.contact_send."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Optional name or phone fragment to filter contacts.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max contacts to return (1–100, default 50).",
                    },
                },
                "required": [],
            },
        },
    },
    "whatsapp_read_chat": {
        "type": "function",
        "function": {
            "name": "whatsapp_read_chat",
            "description": (
                "Read recent 1:1 WhatsApp messages with a contact. Pass a contact name, "
                "phone (with country code), or WhatsApp jid. Only use when the user "
                "explicitly asks to read/summarize a chat. Requires whatsapp.read. "
                "Messages are buffered while WhatsApp stays linked — older history may be empty "
                "until the chat is active."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "recipient": {
                        "type": "string",
                        "description": "Contact name, phone with country code, or jid.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max messages to return (1–80, default 30).",
                    },
                },
                "required": ["recipient"],
            },
        },
    },
    "whatsapp_send_message": {
        "type": "function",
        "function": {
            "name": "whatsapp_send_message",
            "description": (
                "Send a WhatsApp text message to a contact from the user's phonebook, or to a "
                "phone number with country code. ONLY call this when the user explicitly asked "
                "to message that person (never unsolicited outreach). Requires whatsapp.contact_send "
                "and dashboard/WhatsApp approval the first time in a chat. "
                "If this agent also has whatsapp.auto_reply, sending arms a 24h listener so "
                "contact replies auto-route back to this agent."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "recipient": {
                        "type": "string",
                        "description": "Contact name, phone with country code, or jid.",
                    },
                    "message": {
                        "type": "string",
                        "description": "Text body to send (max ~4000 chars).",
                    },
                    "reply_instructions": {
                        "type": "string",
                        "description": (
                            "Optional. What this agent should do when that contact replies "
                            "(requires whatsapp.auto_reply). Stored on the listen session."
                        ),
                    },
                },
                "required": ["recipient", "message"],
            },
        },
    },
    "whatsapp_auto_reply_status": {
        "type": "function",
        "function": {
            "name": "whatsapp_auto_reply_status",
            "description": (
                "List contacts this agent is currently listening to for auto-reply "
                "(armed after whatsapp_send_message when whatsapp.auto_reply is granted)."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    "whatsapp_auto_reply_stop": {
        "type": "function",
        "function": {
            "name": "whatsapp_auto_reply_stop",
            "description": (
                "Stop listening for auto-replies. Pass recipient (name/phone/jid) to stop one "
                "contact, or omit to stop all active listeners for this agent."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "recipient": {
                        "type": "string",
                        "description": "Optional contact name, phone, or jid to stop.",
                    },
                },
                "required": [],
            },
        },
    },
    "whatsapp_auto_reply_set_instructions": {
        "type": "function",
        "function": {
            "name": "whatsapp_auto_reply_set_instructions",
            "description": (
                "Set or update what this agent should do when a contact replies "
                "(auto-reply session). Call after messaging them, or with a resolvable "
                "name/phone/jid. Requires whatsapp.auto_reply."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "recipient": {
                        "type": "string",
                        "description": "Contact name, phone with country code, or jid.",
                    },
                    "instructions": {
                        "type": "string",
                        "description": (
                            "What to do when they reply, e.g. 'Book a 30-min call and confirm the time.'"
                        ),
                    },
                },
                "required": ["recipient", "instructions"],
            },
        },
    },
}


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def _scope_needs_jit(identity: AgentIdentity, scope: str) -> bool:
    jit = set(identity.jit_scopes)
    always = set(identity.always_scopes)
    return scope in jit and scope not in always


def whatsapp_contact_send_needs_jit(identity: AgentIdentity) -> bool:
    return _scope_needs_jit(identity, "whatsapp.contact_send")


def openai_whatsapp_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    """Return OpenAI tool defs for WhatsApp tools allowed by scopes + skill filter."""
    granted = _effective_granted_scopes(identity)
    tool_ids = list(WHATSAPP_TOOL_SCOPES.keys())

    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [
                t
                for t in tool_ids
                if any(s in filt for s in WHATSAPP_TOOL_SCOPES.get(t, ()))
            ]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = WHATSAPP_TOOL_SCOPES.get(tid, ())
        # list_contacts: any of the scopes; others: all required
        if tid == "whatsapp_list_contacts":
            if not any(s in granted for s in req):
                continue
        elif any(s not in granted for s in req):
            continue
        defn = WHATSAPP_TOOL_DEFINITIONS.get(tid)
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
    url = f"{backend_url.rstrip('/')}{path}"
    headers = {"X-QLIX-Runner-Token": runner_token, "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(url, headers=headers, json=body)
    except Exception as exc:
        return f"[failed] WhatsApp request error: {exc}"

    text = resp.text
    try:
        payload = resp.json() if text else {}
    except json.JSONDecodeError:
        payload = {"raw": text[:2000]}

    if resp.status_code >= 400:
        err = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(err, dict):
            return f"[failed] {err.get('code', 'error')}: {err.get('message', text[:300])}"
        return f"[failed] HTTP {resp.status_code}: {text[:300]}"

    return json.dumps(payload, ensure_ascii=False) if isinstance(payload, dict) else str(payload)


def build_whatsapp_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
    qlix_sdk: Any = None,
) -> dict[str, callable]:
    """Pre-bind WhatsApp tool executors for the inference loop."""
    executors: dict[str, callable] = {}
    defs = openai_whatsapp_tool_definitions(identity, skill_filter)
    allowed = {d["function"]["name"] for d in defs if isinstance(d.get("function"), dict)}

    if "whatsapp_send" in allowed:

        def _whatsapp_send(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            raw_path = str(params.get("file_path", "")).strip()
            if not raw_path:
                return "[failed] file_path is required"
            path = Path(raw_path).expanduser()
            if not path.is_file():
                return f"[failed] File not found: {path}"
            try:
                data = path.read_bytes()
            except OSError as exc:
                return f"[failed] Could not read file: {exc}"
            if not data:
                return "[failed] File is empty"
            if len(data) > _MAX_FILE_BYTES:
                return (
                    f"[failed] File too large ({len(data)} bytes); "
                    f"limit is {_MAX_FILE_BYTES} bytes."
                )

            file_name = str(params.get("file_name", "")).strip() or path.name
            body = {
                "runId": run_id,
                "file_name": file_name,
                "content_base64": base64.b64encode(data).decode("ascii"),
            }
            url = (
                f"{backend_url.rstrip('/')}/api/v1/agents/{agent_id}/tools/whatsapp/send-file"
            )
            headers = {
                "X-QLIX-Runner-Token": runner_token,
                "Content-Type": "application/json",
            }
            try:
                with httpx.Client(timeout=120.0) as client:
                    resp = client.post(url, headers=headers, json=body)
            except Exception as exc:
                return f"[failed] WhatsApp send request error: {exc}"

            text = resp.text
            try:
                payload = resp.json() if text else {}
            except json.JSONDecodeError:
                payload = {"raw": text[:2000]}

            if resp.status_code >= 400:
                err = payload.get("error") if isinstance(payload, dict) else None
                if isinstance(err, dict):
                    return (
                        f"[failed] {err.get('code', 'error')}: "
                        f"{err.get('message', text[:300])}"
                    )
                return f"[failed] HTTP {resp.status_code}: {text[:300]}"

            return f"Sent {file_name} to WhatsApp."

        executors["whatsapp_send"] = _whatsapp_send

    if "whatsapp_list_contacts" in allowed:

        def _list_contacts(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            body: dict[str, Any] = {"runId": run_id}
            if params.get("query"):
                body["query"] = str(params["query"])
            if params.get("limit") is not None:
                body["limit"] = int(params["limit"])
            return _post_json(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/whatsapp/list-contacts",
                body=body,
            )

        executors["whatsapp_list_contacts"] = _list_contacts

    if "whatsapp_read_chat" in allowed:

        def _read_chat(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            recipient = str(params.get("recipient", "")).strip()
            if not recipient:
                return "[failed] recipient is required"
            body: dict[str, Any] = {"runId": run_id, "recipient": recipient}
            if params.get("limit") is not None:
                body["limit"] = int(params["limit"])
            return _post_json(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/whatsapp/read-chat",
                body=body,
            )

        executors["whatsapp_read_chat"] = _read_chat

    if "whatsapp_send_message" in allowed:
        jit_granted = False

        async def _send_message(args_json: str) -> str:
            nonlocal jit_granted
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            recipient = str(params.get("recipient", "")).strip()
            message = str(params.get("message", "")).strip()
            if not recipient:
                return "[failed] recipient is required"
            if not message:
                return "[failed] message is required"

            body: dict[str, Any] = {
                "runId": run_id,
                "recipient": recipient,
                "message": message,
            }
            if params.get("reply_instructions"):
                body["replyInstructions"] = str(params["reply_instructions"]).strip()

            if whatsapp_contact_send_needs_jit(identity) and not jit_granted:
                jit_payload = {
                    "runId": run_id,
                    "tool": "whatsapp_send_message",
                    "recipient": recipient,
                    "message": message[:300],
                }
                try:
                    from .jit import request_jit_via_runner

                    approval = await request_jit_via_runner(
                        agent_id=agent_id,
                        runner_token=runner_token,
                        backend_url=backend_url,
                        did=identity.did,
                        private_key_hex=identity.private_key_hex,
                        action_type="whatsapp.contact_send",
                        payload=jit_payload,
                        qlix_sdk=qlix_sdk,
                    )
                    token = getattr(approval, "jit_token", None)
                    if token:
                        body["jitToken"] = token
                    jit_granted = True
                except Exception as exc:  # noqa: BLE001
                    return f"[failed] JIT approval not granted: {exc}"

            return _post_json(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/whatsapp/send-message",
                body=body,
            )

        executors["whatsapp_send_message"] = _send_message

    if "whatsapp_auto_reply_status" in allowed:

        def _auto_reply_status(args_json: str) -> str:
            return _post_json(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/whatsapp/auto-reply/status",
                body={"runId": run_id},
            )

        executors["whatsapp_auto_reply_status"] = _auto_reply_status

    if "whatsapp_auto_reply_stop" in allowed:

        def _auto_reply_stop(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            body: dict[str, Any] = {"runId": run_id}
            if params.get("recipient"):
                body["recipient"] = str(params["recipient"])
            return _post_json(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/whatsapp/auto-reply/stop",
                body=body,
            )

        executors["whatsapp_auto_reply_stop"] = _auto_reply_stop

    if "whatsapp_auto_reply_set_instructions" in allowed:

        def _auto_reply_set_instructions(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            recipient = str(params.get("recipient", "")).strip()
            instructions = str(params.get("instructions", "")).strip()
            if not recipient:
                return "[failed] recipient is required"
            if not instructions:
                return "[failed] instructions are required"
            return _post_json(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/whatsapp/auto-reply/set-instructions",
                body={
                    "runId": run_id,
                    "recipient": recipient,
                    "instructions": instructions,
                },
            )

        executors["whatsapp_auto_reply_set_instructions"] = _auto_reply_set_instructions

    return executors


def is_whatsapp_tool(tool_name: str) -> bool:
    return tool_name in WHATSAPP_TOOL_SCOPES
