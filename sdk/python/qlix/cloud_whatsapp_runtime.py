"""Comms tool (cloud + hybrid): send a runner-local file to the user's linked WhatsApp.

The runner does not share a filesystem with the WhatsApp service, so the file's
bytes are uploaded (base64) to the Qlix backend, which stages them to a temp file
the WhatsApp service can read. Gated by the ``whatsapp.send`` scope.
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
                "the user's linked WhatsApp. Pass file_path to a file already created in the "
                "runner — e.g. the path returned by browser_ab_screenshot or browser_ab_pdf. "
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
}


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


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
                t for t in tool_ids if any(s in filt for s in WHATSAPP_TOOL_SCOPES.get(t, ()))
            ]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = WHATSAPP_TOOL_SCOPES.get(tid, ())
        if any(s not in granted for s in req):
            continue
        defn = WHATSAPP_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def build_whatsapp_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
) -> dict[str, callable]:
    """Pre-bind WhatsApp tool executors for the inference loop."""
    executors: dict[str, callable] = {}
    defs = openai_whatsapp_tool_definitions(identity, skill_filter)
    allowed = {d["function"]["name"] for d in defs if isinstance(d.get("function"), dict)}

    if "whatsapp_send" not in allowed:
        return executors

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
            return f"[failed] File too large ({len(data)} bytes); limit is {_MAX_FILE_BYTES} bytes."

        file_name = str(params.get("file_name", "")).strip() or path.name
        body = {
            "runId": run_id,
            "file_name": file_name,
            "content_base64": base64.b64encode(data).decode("ascii"),
        }
        url = f"{backend_url.rstrip('/')}/api/v1/agents/{agent_id}/tools/whatsapp/send-file"
        headers = {"X-QLIX-Runner-Token": runner_token, "Content-Type": "application/json"}
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
                return f"[failed] {err.get('code', 'error')}: {err.get('message', text[:300])}"
            return f"[failed] HTTP {resp.status_code}: {text[:300]}"

        return f"Sent {file_name} to WhatsApp."

    executors["whatsapp_send"] = _whatsapp_send
    return executors


def is_whatsapp_tool(tool_name: str) -> bool:
    return tool_name in WHATSAPP_TOOL_SCOPES
