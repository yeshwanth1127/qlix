"""Brain document lookup tools for runners (send originals via WhatsApp)."""

from __future__ import annotations

import json
from typing import Any

from .identity import AgentIdentity

BRAIN_FILE_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "brain_find_documents": ("brain.query",),
}

BRAIN_FILE_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "brain_find_documents": {
        "type": "function",
        "function": {
            "name": "brain_find_documents",
            "description": (
                "Find company-brain documents by title/keyword (e.g. brochure). "
                "Returns documentId values to pass to whatsapp_send_document as brain_document_id "
                "when sending a real file to a contact."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search text (e.g. brochure, UWA, PDF title words).",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 8).",
                    },
                },
                "required": [],
            },
        },
    },
}


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def openai_brain_file_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    granted = _effective_granted_scopes(identity)
    tool_ids = list(BRAIN_FILE_TOOL_SCOPES.keys())

    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [
                t
                for t in tool_ids
                if any(s in filt for s in BRAIN_FILE_TOOL_SCOPES.get(t, ()))
            ]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = BRAIN_FILE_TOOL_SCOPES.get(tid, ())
        if not any(s in granted for s in req):
            continue
        defn = BRAIN_FILE_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def build_brain_file_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
) -> dict[str, callable]:
    from .cloud_whatsapp_runtime import _post_json

    executors: dict[str, callable] = {}
    defs = openai_brain_file_tool_definitions(identity, skill_filter)
    allowed = {d["function"]["name"] for d in defs if isinstance(d.get("function"), dict)}

    if "brain_find_documents" in allowed:

        def _find(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            if not isinstance(params, dict):
                params = {}
            body: dict[str, Any] = {"runId": run_id}
            if params.get("query"):
                body["query"] = str(params["query"]).strip()
            if params.get("limit") is not None:
                body["limit"] = int(params["limit"])
            return _post_json(
                backend_url=backend_url,
                runner_token=runner_token,
                agent_id=agent_id,
                path=f"/api/v1/agents/{agent_id}/tools/brain/find-documents",
                body=body,
            )

        executors["brain_find_documents"] = _find

    return executors
