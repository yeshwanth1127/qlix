"""Cloud runner: email.read / email.send tools via Qlix backend proxy → n8n."""

from __future__ import annotations

import json
from typing import Any

import httpx

from .identity import AgentIdentity

EMAIL_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "email_read": ("email.read",),
    "email_send": ("email.send",),
}

EMAIL_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "email_read": {
        "type": "function",
        "function": {
            "name": "email_read",
            "description": (
                "Read or search emails from the connected Gmail account. "
                "Use query for Gmail search syntax (e.g. is:unread, from:alice@example.com). "
                "Provide messageId to fetch a single message. "
                "File attachments are downloaded into the Qlix sandbox (same store as "
                "agent-generated files), and extractable text (PDF/DOCX/XLSX/CSV/text) is "
                "included in each message's attachments[].extractedText for you to use. "
                "Also share attachments[].url download links with the user when relevant. "
                "Images may only have a URL (no text extract)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Gmail search query. Defaults to is:unread.",
                    },
                    "maxResults": {
                        "type": "integer",
                        "description": "Maximum messages to return (1-25). Defaults to 10.",
                    },
                    "messageId": {
                        "type": "string",
                        "description": "Optional Gmail message id to fetch a single message.",
                    },
                    "includeAttachments": {
                        "type": "boolean",
                        "description": (
                            "Download + extract attachments into the sandbox and return "
                            "their text to you (default true). Set false only for a quick "
                            "metadata scan without files."
                        ),
                    },
                },
            },
        },
    },
    "email_send": {
        "type": "function",
        "function": {
            "name": "email_send",
            "description": (
                "Gmail send / draft / list drafts / delete draft via the connected account. "
                "ROUTE FROM THE USER MESSAGE using mode: "
                "mode='draft' to compose/prepare/write without sending; "
                "mode='send' to deliver; "
                "mode='list_drafts' to list existing Gmail drafts (use this before deleting "
                "when you don't already have a draftId); "
                "mode='delete_draft' to delete a draft (requires draftId from a prior draft "
                "create or list_drafts — never invent draftId). "
                "Default to mode='send' only when intent is clearly to deliver. "
                "IMPORTANT: mode=draft does NOT deliver mail. Tell the user the draft is in "
                "the connected mailbox's Drafts (see mailboxEmail in the tool result), and "
                "never say 'sent' for a draft. Recipients in 'to' only prefill the draft. "
                "CRITICAL for mode=send: only send to REAL email addresses obtained from tools such as "
                "list_leads / gmb_search_leads or provided by the user. NEVER invent or guess "
                "addresses (e.g. info@cafe1.com, contact@business2.com) — fabricated recipients "
                "are rejected by the server. For lead outreach you MUST follow this order: "
                "(1) gmb_search_leads, (2) list_leads includeAll=true, "
                "(3) for EACH lead in needsBrowserEnrichment: browser_ab_open(website) "
                "then update_lead_email or record_lead_enrichment(no_email_on_site), "
                "(4) list_leads contactable and present verified emails to the user, "
                "(5) only then email_send with mode=send. Sends are blocked while website leads "
                "lack browser enrichment. Never use Wix placeholders like info@mysite.com. "
                "The first mode=send in a chat may pause for one-time Approve/Deny in this chat; "
                "draft / list_drafts / delete_draft never require approval. "
                "If Gmail is not connected, tell the user to open Connectors → Google (Gmail) → Connect Google. "
                "If draft ops fail for missing compose permission, tell them to reconnect Gmail in Connectors."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["send", "draft", "list_drafts", "delete_draft"],
                        "description": (
                            "send = deliver now (JIT may apply). "
                            "draft = save to Gmail Drafts. "
                            "list_drafts = list drafts (returns draftId values). "
                            "delete_draft = permanently delete a draft by draftId."
                        ),
                    },
                    "to": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Recipient email addresses. Required for mode=send; "
                            "optional for mode=draft; unused for list/delete."
                        ),
                    },
                    "subject": {
                        "type": "string",
                        "description": "Email subject. Required for send/draft.",
                    },
                    "bodyText": {
                        "type": "string",
                        "description": "Plain-text body. Required for send/draft.",
                    },
                    "draftId": {
                        "type": "string",
                        "description": (
                            "Gmail draft resource id for mode=delete_draft. "
                            "Get it from mode=draft response or mode=list_drafts."
                        ),
                    },
                    "maxResults": {
                        "type": "integer",
                        "description": "For mode=list_drafts: max drafts to return (1-25).",
                    },
                    "replyToMessageId": {
                        "type": "string",
                        "description": "Optional Gmail message id to reply in-thread.",
                    },
                    "metadata": {
                        "type": "object",
                        "description": "Optional outreach metadata for lead campaigns.",
                        "properties": {
                            "campaignId": { "type": "string" },
                            "leadId": { "type": "string" },
                        },
                    },
                },
                "required": ["mode"],
            },
        },
    },
}


def email_mode_routing_guidance(instruction: str) -> str:
    """Run-context hint so the model picks email_send mode from the user message."""
    lower = (instruction or "").lower()
    delete_markers = (
        "delete draft",
        "delete the draft",
        "remove draft",
        "remove the draft",
        "discard draft",
        "discard the draft",
        "delete that draft",
        "delete my draft",
        "delete a draft",
    )
    list_markers = (
        "list drafts",
        "show drafts",
        "my drafts",
        "gmail drafts",
        "what drafts",
    )
    draft_markers = (
        "draft",
        "compose",
        "prepare an email",
        "prepare email",
        "write an email",
        "write email",
        "save as draft",
        "don't send",
        "do not send",
        "dont send",
        "without sending",
    )
    send_markers = (
        "send email",
        "send an email",
        "send the email",
        "email them",
        "email him",
        "email her",
        "mail them",
        "deliver the email",
    )
    wants_delete = any(m in lower for m in delete_markers)
    wants_list = any(m in lower for m in list_markers)
    wants_draft = any(m in lower for m in draft_markers)
    wants_send = any(m in lower for m in send_markers)
    if wants_delete:
        return (
            "## Email tool routing\n"
            "The user asked to delete a draft — call email_send with mode='list_drafts' "
            "if you don't already have the draftId, then mode='delete_draft' with that draftId. "
            "Do not use mode='send'."
        )
    if wants_list and not wants_draft:
        return (
            "## Email tool routing\n"
            "The user asked about drafts — call email_send with mode='list_drafts'."
        )
    if wants_draft and not wants_send and not wants_delete:
        return (
            "## Email tool routing\n"
            "The user asked to draft/compose — call email_send with mode='draft'. "
            "Do not use mode='send' unless they explicitly ask to send."
        )
    if wants_send and not wants_draft:
        return (
            "## Email tool routing\n"
            "The user asked to send — call email_send with mode='send' "
            "(approval may be required once per chat)."
        )
    if "email" in lower or "gmail" in lower or "mail" in lower:
        return (
            "## Email tool routing\n"
            "Use email_send mode='draft' / 'send' / 'list_drafts' / 'delete_draft' "
            "to match the user's wording."
        )
    return ""


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def email_send_needs_jit(identity: AgentIdentity) -> bool:
    """True when email.send is JIT-gated (not in always_scopes)."""
    jit = set(identity.jit_scopes)
    always = set(identity.always_scopes)
    return "email.send" in jit and "email.send" not in always


def openai_email_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    """Return OpenAI tool defs for email tools allowed by scopes + skill filter."""
    granted = _effective_granted_scopes(identity)
    tool_ids = list(EMAIL_TOOL_SCOPES.keys())

    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [t for t in tool_ids if any(s in filt for s in EMAIL_TOOL_SCOPES.get(t, ()))]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = EMAIL_TOOL_SCOPES.get(tid, ())
        if any(s not in granted for s in req):
            continue
        defn = EMAIL_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def _post_email_tool(
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
    except Exception as exc:
        return f"[failed] Email tool request error: {exc}"

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
            issues = err.get("issues")
            if isinstance(issues, list) and issues and "Invalid email send payload (" not in str(message):
                bits: list[str] = []
                for issue in issues[:6]:
                    if not isinstance(issue, dict):
                        continue
                    path = ".".join(str(p) for p in (issue.get("path") or [])) or "(root)"
                    bits.append(f"{path}: {issue.get('message') or 'invalid'}")
                if bits:
                    message = f"{message} ({'; '.join(bits)})"
            instructions = err.get("connectInstructions")
            if instructions and code in (
                "connector_not_configured",
                "gmail_compose_scope_missing",
            ):
                return f"[failed] {code}: {message}\n\n{instructions}"
            return f"[failed] {code}: {message}"
        return f"[failed] HTTP {resp.status_code}: {text[:500]}"

    return json.dumps(data, ensure_ascii=False)


def build_email_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
    qlix_sdk: Any = None,
) -> dict[str, callable]:
    """Pre-bind email tool executors for the inference loop."""
    executors: dict[str, callable] = {}
    defs = openai_email_tool_definitions(identity, skill_filter)
    allowed = {d["function"]["name"] for d in defs if isinstance(d.get("function"), dict)}

    if "email_read" in allowed:

        def _email_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            body: dict[str, Any] = {"runId": run_id}
            if params.get("query"):
                body["query"] = params["query"]
            if params.get("maxResults") is not None:
                body["maxResults"] = params["maxResults"]
            if params.get("messageId"):
                body["messageId"] = params["messageId"]
            if params.get("includeAttachments") is not None:
                body["includeAttachments"] = bool(params.get("includeAttachments"))
            return _post_email_tool(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/email/read",
                body=body,
            )

        executors["email_read"] = _email_read

    if "email_send" in allowed:

        def _coerce_recipients(raw: Any) -> list[str]:
            out: list[str] = []

            def _push(value: Any) -> None:
                if value is None:
                    return
                if isinstance(value, str):
                    for part in value.replace(";", ",").split(","):
                        piece = part.strip()
                        if not piece:
                            continue
                        if "<" in piece and ">" in piece:
                            start = piece.rfind("<")
                            end = piece.rfind(">")
                            if start >= 0 and end > start:
                                piece = piece[start + 1 : end].strip()
                        if piece:
                            out.append(piece)
                    return
                if isinstance(value, list):
                    for item in value:
                        _push(item)
                    return
                if isinstance(value, dict) and value.get("email") is not None:
                    _push(value.get("email"))

            _push(raw)
            # Preserve order, drop empties/dupes.
            seen: set[str] = set()
            uniq: list[str] = []
            for addr in out:
                key = addr.lower()
                if key in seen:
                    continue
                seen.add(key)
                uniq.append(addr)
            return uniq[:20]

        async def _email_send(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            mode_raw = str(params.get("mode") or "send").strip().lower()
            if mode_raw in ("draft", "list_drafts", "delete_draft"):
                mode = mode_raw
            else:
                mode = "send"
            body_text = params.get("bodyText")
            if body_text is None:
                body_text = params.get("body")
            if body_text is None:
                body_text = params.get("text")
            if body_text is None:
                body_text = params.get("message")
            if body_text is None:
                body_text = params.get("content")
            body: dict[str, Any] = {
                "runId": run_id,
                "mode": mode,
                "to": _coerce_recipients(params.get("to")),
                "subject": "" if params.get("subject") is None else str(params.get("subject")),
                "bodyText": "" if body_text is None else str(body_text),
            }
            if params.get("draftId"):
                body["draftId"] = params["draftId"]
            if params.get("maxResults") is not None:
                body["maxResults"] = params["maxResults"]
            if params.get("replyToMessageId"):
                body["replyToMessageId"] = params["replyToMessageId"]
            meta = params.get("metadata")
            if isinstance(meta, dict) and (meta.get("campaignId") or meta.get("leadId")):
                body["metadata"] = {
                    k: meta[k]
                    for k in ("campaignId", "leadId")
                    if meta.get(k)
                }

            # Draft ops stay in Gmail — never request JIT approval.
            jit_token = params.get("jitToken")
            if mode == "send" and email_send_needs_jit(identity) and not jit_token:
                jit_payload = {
                    "runId": run_id,
                    "tool": "email_send",
                    "mode": mode,
                    "to": body.get("to"),
                    "subject": body.get("subject"),
                }
                try:
                    from .jit import request_jit_via_runner

                    approval = await request_jit_via_runner(
                        agent_id=agent_id,
                        runner_token=runner_token,
                        backend_url=backend_url,
                        did=identity.did,
                        private_key_hex=identity.private_key_hex,
                        action_type="email.send",
                        payload=jit_payload,
                        qlix_sdk=qlix_sdk,
                    )
                    jit_token = getattr(approval, "jit_token", None)
                except Exception as exc:  # noqa: BLE001
                    return f"[failed] JIT approval not granted: {exc}"

            if jit_token:
                body["jitToken"] = jit_token

            return _post_email_tool(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/email/send",
                body=body,
            )

        executors["email_send"] = _email_send

    return executors


def is_email_tool(tool_name: str) -> bool:
    return tool_name in EMAIL_TOOL_SCOPES
