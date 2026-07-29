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
                "Provide messageId to fetch a single message."
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
                },
            },
        },
    },
    "email_send": {
        "type": "function",
        "function": {
            "name": "email_send",
            "description": (
                "Send an email via the connected Gmail account. "
                "CRITICAL: only send to REAL email addresses obtained from tools such as "
                "list_leads / gmb_search_leads or provided by the user. NEVER invent or guess "
                "addresses (e.g. info@cafe1.com, contact@business2.com) — fabricated recipients "
                "are rejected by the server. For lead outreach you MUST follow this order: "
                "(1) gmb_search_leads, (2) list_leads includeAll=true, "
                "(3) for EACH lead in needsBrowserEnrichment: browser_ab_open(website) "
                "then update_lead_email or record_lead_enrichment(no_email_on_site), "
                "(4) list_leads contactable and present verified emails to the user, "
                "(5) only then email_send. Sends are blocked while website leads lack browser enrichment. "
                "Never use Wix placeholders like info@mysite.com. "
                "The first send in a chat may pause for one-time dashboard approval; "
                "after you approve, later sends in the same conversation proceed automatically. "
                "If Gmail is not connected, tell the user to open Connectors → Google (Gmail) → Connect Google."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Recipient email addresses.",
                    },
                    "subject": {"type": "string", "description": "Email subject line."},
                    "bodyText": {"type": "string", "description": "Plain-text email body."},
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
                "required": ["to", "subject", "bodyText"],
            },
        },
    },
}


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
            instructions = err.get("connectInstructions")
            if instructions and code == "connector_not_configured":
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
            return _post_email_tool(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/email/read",
                body=body,
            )

        executors["email_read"] = _email_read

    if "email_send" in allowed:

        async def _email_send(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            body: dict[str, Any] = {
                "runId": run_id,
                "to": params.get("to") or [],
                "subject": params.get("subject") or "",
                "bodyText": params.get("bodyText") or "",
            }
            if params.get("replyToMessageId"):
                body["replyToMessageId"] = params["replyToMessageId"]
            meta = params.get("metadata")
            if isinstance(meta, dict) and (meta.get("campaignId") or meta.get("leadId")):
                body["metadata"] = {
                    k: meta[k]
                    for k in ("campaignId", "leadId")
                    if meta.get(k)
                }

            jit_token = params.get("jitToken")
            if email_send_needs_jit(identity) and not jit_token:
                if qlix_sdk is None:
                    return (
                        "[failed] email.send requires dashboard approval but the runner "
                        "could not initialize the approval client"
                    )
                try:
                    approval = await qlix_sdk.jit.request_and_wait(
                        action_type="email.send",
                        payload={
                            "runId": run_id,
                            "tool": "email_send",
                            "to": body.get("to"),
                            "subject": body.get("subject"),
                        },
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
