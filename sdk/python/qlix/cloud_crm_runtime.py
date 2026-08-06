"""Cloud runner: provider-agnostic CRM tools via Qlix backend proxy."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from .identity import AgentIdentity

CRM_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "crm_list_modules": ("crm.read",),
    "crm_describe_module": ("crm.read",),
    "crm_query": ("crm.read",),
    "crm_search": ("crm.read",),
    "crm_get": ("crm.read",),
    "crm_list_attachments": ("crm.read",),
    "crm_download_attachment": ("crm.read",),
    "crm_create": ("crm.write",),
    "crm_update": ("crm.write",),
    "crm_delete": ("crm.delete",),
    "crm_bulk_create": ("crm.write",),
    "crm_bulk_update": ("crm.write",),
    "crm_convert_lead": ("crm.write",),
    "crm_link": ("crm.write",),
    "crm_unlink": ("crm.write",),
    "crm_upload_attachment": ("crm.write",),
    "crm_add_note": ("crm.write",),
}

CRM_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "crm_list_modules": {
        "type": "function",
        "function": {
            "name": "crm_list_modules",
            "description": (
                "List available CRM modules/objects for the connected platform "
                "(Leads, Contacts, Deals, custom modules, etc.). Call this first when unsure of module names."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    "crm_describe_module": {
        "type": "function",
        "function": {
            "name": "crm_describe_module",
            "description": "Get field API names, types, and picklists for a CRM module. Use before create/update.",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string", "description": "CRM module API name."},
                },
                "required": ["module"],
            },
        },
    },
    "crm_query": {
        "type": "function",
        "function": {
            "name": "crm_query",
            "description": (
                "Run an advanced read-only query against the connected CRM "
                "(COQL on Zoho, provider-native query language returned by crm_list_modules). "
                "Use for filters, date ranges, and aggregations. "
                "On Zoho: every SELECT needs WHERE (e.g. WHERE id is not null); "
                "use COUNT(id) not COUNT(*) or count(id); write null checks as "
                "lowercase is not null / is null (not IS NOT NULL); use != not <>."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Provider-native SELECT query."},
                },
                "required": ["query"],
            },
        },
    },
    "crm_search": {
        "type": "function",
        "function": {
            "name": "crm_search",
            "description": "Simple search or list records in a CRM module. Optional word filter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "word": {"type": "string"},
                    "fields": {"type": "array", "items": {"type": "string"}},
                    "page": {"type": "integer"},
                    "perPage": {"type": "integer"},
                },
                "required": ["module"],
            },
        },
    },
    "crm_get": {
        "type": "function",
        "function": {
            "name": "crm_get",
            "description": "Fetch a single CRM record by module and record id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "recordId": {
                        "type": "string",
                        "description": "Zoho record id (long numeric string from crm_search), or name/ordinal — resolved automatically.",
                    },
                    "fields": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["module", "recordId"],
            },
        },
    },
    "crm_create": {
        "type": "function",
        "function": {
            "name": "crm_create",
            "description": (
                "Create a CRM record (Leads, Contacts, Deals, etc.). Use crm_describe_module for field API names. "
                "When the user asks to add or create a record, call this tool immediately with the fields they gave — "
                "do not tell them to check the dashboard first. If approval is required, an Approve/Deny card "
                "appears in this chat; after they approve once, later CRM writes in this conversation proceed automatically."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "fields": {"type": "object"},
                },
                "required": ["module", "fields"],
            },
        },
    },
    "crm_update": {
        "type": "function",
        "function": {
            "name": "crm_update",
            "description": "Update an existing CRM record. Provide only changed fields.",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "recordId": {
                        "type": "string",
                        "description": "Zoho record id (long numeric string from crm_search), or name/ordinal — resolved automatically.",
                    },
                    "fields": {"type": "object"},
                },
                "required": ["module", "recordId", "fields"],
            },
        },
    },
    "crm_delete": {
        "type": "function",
        "function": {
            "name": "crm_delete",
            "description": (
                "Delete a CRM record. Call this tool when the user asks to delete — an Approve/Deny prompt "
                "appears in this chat if approval is required; do not ask the user to check the dashboard."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "recordId": {
                        "type": "string",
                        "description": "Zoho record id (long numeric string from crm_search), or name/ordinal — resolved automatically.",
                    },
                },
                "required": ["module", "recordId"],
            },
        },
    },
    "crm_bulk_create": {
        "type": "function",
        "function": {
            "name": "crm_bulk_create",
            "description": "Create multiple CRM records in one call (platform batch limits apply).",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "records": {"type": "array", "items": {"type": "object"}},
                },
                "required": ["module", "records"],
            },
        },
    },
    "crm_bulk_update": {
        "type": "function",
        "function": {
            "name": "crm_bulk_update",
            "description": "Update multiple CRM records. Each record needs id in fields or parallel recordIds array.",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "records": {"type": "array", "items": {"type": "object"}},
                    "recordIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["module", "records"],
            },
        },
    },
    "crm_convert_lead": {
        "type": "function",
        "function": {
            "name": "crm_convert_lead",
            "description": "Convert a lead to contact/account/deal (platform-specific; supported on Zoho, Salesforce, etc.).",
            "parameters": {
                "type": "object",
                "properties": {
                    "leadId": {"type": "string"},
                    "dealName": {"type": "string"},
                    "accountName": {"type": "string"},
                    "overwrite": {"type": "boolean"},
                },
                "required": ["leadId"],
            },
        },
    },
    "crm_link": {
        "type": "function",
        "function": {
            "name": "crm_link",
            "description": "Link two related CRM records (e.g. deal to account).",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "recordId": {
                        "type": "string",
                        "description": "Zoho record id (long numeric string from crm_search), or name/ordinal — resolved automatically.",
                    },
                    "relatedModule": {"type": "string"},
                    "relatedRecordId": {"type": "string"},
                },
                "required": ["module", "recordId", "relatedModule", "relatedRecordId"],
            },
        },
    },
    "crm_unlink": {
        "type": "function",
        "function": {
            "name": "crm_unlink",
            "description": "Remove a link between two CRM records.",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "recordId": {
                        "type": "string",
                        "description": "Zoho record id (long numeric string from crm_search), or name/ordinal — resolved automatically.",
                    },
                    "relatedModule": {"type": "string"},
                    "relatedRecordId": {"type": "string"},
                },
                "required": ["module", "recordId", "relatedModule", "relatedRecordId"],
            },
        },
    },
    "crm_list_attachments": {
        "type": "function",
        "function": {
            "name": "crm_list_attachments",
            "description": "List file attachments on a CRM record.",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "recordId": {
                        "type": "string",
                        "description": "Zoho record id (long numeric string from crm_search), or name/ordinal — resolved automatically.",
                    },
                },
                "required": ["module", "recordId"],
            },
        },
    },
    "crm_upload_attachment": {
        "type": "function",
        "function": {
            "name": "crm_upload_attachment",
            "description": (
                "Upload a file attachment to a CRM record. Provide fileBase64 from a generated/sandbox file."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "recordId": {
                        "type": "string",
                        "description": "Zoho record id (long numeric string from crm_search), or name/ordinal — resolved automatically.",
                    },
                    "fileName": {"type": "string"},
                    "fileBase64": {"type": "string"},
                    "mimeType": {"type": "string"},
                },
                "required": ["module", "recordId", "fileName", "fileBase64"],
            },
        },
    },
    "crm_download_attachment": {
        "type": "function",
        "function": {
            "name": "crm_download_attachment",
            "description": "Download a CRM attachment as base64.",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "recordId": {
                        "type": "string",
                        "description": "Zoho record id (long numeric string from crm_search), or name/ordinal — resolved automatically.",
                    },
                    "attachmentId": {"type": "string"},
                },
                "required": ["module", "recordId", "attachmentId"],
            },
        },
    },
    "crm_add_note": {
        "type": "function",
        "function": {
            "name": "crm_add_note",
            "description": "Add a note/comment on a CRM record.",
            "parameters": {
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "recordId": {
                        "type": "string",
                        "description": "Zoho record id (long numeric string from crm_search), or name/ordinal — resolved automatically.",
                    },
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["module", "recordId", "content"],
            },
        },
    },
}

# tool name -> backend path suffix under /tools/crm/
CRM_TOOL_PATHS: dict[str, str] = {
    "crm_list_modules": "modules",
    "crm_describe_module": "describe",
    "crm_query": "query",
    "crm_search": "search",
    "crm_get": "get",
    "crm_create": "create",
    "crm_update": "update",
    "crm_delete": "delete",
    "crm_bulk_create": "bulk-create",
    "crm_bulk_update": "bulk-update",
    "crm_convert_lead": "convert-lead",
    "crm_link": "link",
    "crm_unlink": "unlink",
    "crm_list_attachments": "attachments/list",
    "crm_upload_attachment": "attachments/upload",
    "crm_download_attachment": "attachments/download",
    "crm_add_note": "add-note",
}

JIT_SCOPES_BY_TOOL: dict[str, str] = {
    "crm_create": "crm.write",
    "crm_update": "crm.write",
    "crm_delete": "crm.delete",
    "crm_bulk_create": "crm.write",
    "crm_bulk_update": "crm.write",
    "crm_convert_lead": "crm.write",
    "crm_link": "crm.write",
    "crm_unlink": "crm.write",
    "crm_upload_attachment": "crm.write",
    "crm_add_note": "crm.write",
}


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def _crm_scope_needs_jit(identity: AgentIdentity, scope: str) -> bool:
    jit = set(identity.jit_scopes)
    always = set(identity.always_scopes)
    return scope in jit and scope not in always


def crm_jit_needs_sdk(identity: AgentIdentity) -> bool:
    """True when any CRM write/delete tool is JIT-gated (not in always_scopes)."""
    jit = set(identity.jit_scopes)
    always = set(identity.always_scopes)
    for scope in set(JIT_SCOPES_BY_TOOL.values()):
        if scope in jit and scope not in always:
            return True
    return False


def openai_crm_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    granted = _effective_granted_scopes(identity)
    tool_ids = list(CRM_TOOL_SCOPES.keys())

    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [t for t in tool_ids if any(s in filt for s in CRM_TOOL_SCOPES.get(t, ()))]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = CRM_TOOL_SCOPES.get(tid, ())
        if any(s not in granted for s in req):
            continue
        defn = CRM_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def _post_crm_tool(
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
        return f"[failed] CRM tool request error: {exc}"

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


def build_crm_tool_executors(
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
    defs = openai_crm_tool_definitions(identity, skill_filter)
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
                **{k: params.get(k) for k in ("module", "recordId")},
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
        if jit_scope and _crm_scope_needs_jit(identity, jit_scope) and not jit_token:
            try:
                jit_token = await _ensure_jit(jit_scope, tool, params)
            except Exception as exc:  # noqa: BLE001
                return f"[failed] JIT approval not granted: {exc}"
        if jit_token:
            body["jitToken"] = jit_token

        path_suffix = CRM_TOOL_PATHS.get(tool, tool.replace("_", "-"))
        return _post_crm_tool(
            backend_url=backend_url,
            runner_token=runner_token,
            agent_id=agent_id,
            path=f"/api/v1/agents/{agent_id}/tools/crm/{path_suffix}",
            body=body,
        )

    for tool in allowed:

        def _factory(tool_name: str):
            async def _execute(args_json: str) -> str:
                return await _run(tool_name, args_json)

            return _execute

        executors[tool] = _factory(tool)

    return executors
