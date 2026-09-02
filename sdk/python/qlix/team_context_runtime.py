"""Generic Context Plane tools for AgentRuns and Team workers.

Prompts carry compact ``ctx:*`` references. Agents resolve several refs in one
bounded, runner-authenticated call instead of inheriting copied histories.
"""

from __future__ import annotations

import json
from typing import Any

import httpx


TEAM_CONTEXT_TOOL_DEFINITION: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "context_get",
        "description": (
            "Resolve one or more ctx:* references from the Context Plane. Select only "
            "the fields needed for this dispatch and keep maxChars small."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "refs": {
                    "type": "array",
                    "items": {"type": "string", "pattern": "^ctx:"},
                    "minItems": 1,
                    "maxItems": 12,
                },
                "select": {
                    "type": "array",
                    "items": {"type": "string"},
                    "maxItems": 24,
                    "description": "Optional dot paths, e.g. data.findings or data.provenance.",
                },
                "maxChars": {"type": "integer", "minimum": 1000, "maximum": 64000},
            },
            "required": ["refs"],
        },
    },
}

CONTEXT_SEARCH_TOOL_DEFINITION: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "context_search",
        "description": (
            "Search in-scope Brain chunks and Context Plane objects for this run. "
            "Tenant, agent ACL, sources, and a relevance threshold are applied before ranking. "
            "Do not use this to reach another org or collections outside the requested filter."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": 2000},
                "sources": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["brain", "context_object"]},
                    "maxItems": 4,
                },
                "collectionIds": {
                    "type": "array",
                    "items": {"type": "string"},
                    "maxItems": 20,
                },
                "maxItems": {"type": "integer", "minimum": 1, "maximum": 12},
                "maxChars": {"type": "integer", "minimum": 400, "maximum": 8000},
            },
            "required": ["query"],
        },
    },
}

_STATE_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "state_read",
            "description": "Read selected namespaces from this execution's structured state.",
            "parameters": {
                "type": "object",
                "properties": {
                    "select": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 24,
                        "description": "Optional dotted paths, e.g. intent.goal or outputs.",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "state_patch",
            "description": (
                "Patch this execution's structured state with optimistic concurrency. "
                "Allowed namespaces: progress, outputs, decisions, artifacts."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "baseVersion": {"type": "integer", "minimum": 1},
                    "idempotencyKey": {"type": "string"},
                    "operations": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 16,
                        "items": {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "enum": ["set", "merge"]},
                                "path": {"type": "string"},
                                "value": {},
                            },
                            "required": ["op", "path"],
                        },
                    },
                },
                "required": ["baseVersion", "operations"],
            },
        },
    },
]


def openai_team_context_tool_definitions(
    skill_filter: list[str] | None,
    *,
    enable: bool = False,
    enable_search: bool = False,
) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    if enable:
        tools.append(TEAM_CONTEXT_TOOL_DEFINITION)
        tools.append(CONTEXT_SEARCH_TOOL_DEFINITION)
        tools.extend(_STATE_TOOL_DEFINITIONS)
    elif enable_search:
        tools.append(CONTEXT_SEARCH_TOOL_DEFINITION)
    return tools


def _post_context_tool(
    *,
    backend_url: str,
    agent_id: str,
    runner_token: str,
    path: str,
    body: dict[str, Any],
) -> str:
    url = f"{backend_url.rstrip('/')}/api/v1/agents/{agent_id}/tools/context/{path}"
    headers = {"X-QLIX-Runner-Token": runner_token, "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(url, headers=headers, json=body)
    except Exception as exc:  # noqa: BLE001
        return f"[failed] Context request error: {exc}"
    try:
        payload = response.json() if response.text else {}
    except json.JSONDecodeError:
        payload = {"raw": response.text[:4000]}
    if response.status_code >= 400:
        error = payload.get("error") if isinstance(payload, dict) else None
        message = error.get("message") if isinstance(error, dict) else response.text[:500]
        return f"[failed] {message or 'Context request failed'}"
    return json.dumps(payload, ensure_ascii=False)


def build_team_context_tool_executors(
    *,
    skill_filter: list[str] | None,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
    enable: bool = False,
    enable_search: bool = False,
) -> dict[str, callable]:
    definitions = openai_team_context_tool_definitions(
        skill_filter,
        enable=enable,
        enable_search=enable_search,
    )
    if not definitions:
        return {}

    executors: dict[str, callable] = {}
    names = {item["function"]["name"] for item in definitions}

    if "context_get" in names:
        def _context_get(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            body: dict[str, Any] = {
                "runId": run_id,
                "refs": params.get("refs") or [],
            }
            if isinstance(params.get("select"), list):
                body["select"] = params["select"]
            if params.get("maxChars") is not None:
                body["maxChars"] = params["maxChars"]
            return _post_context_tool(
                backend_url=backend_url,
                agent_id=agent_id,
                runner_token=runner_token,
                path="resolve",
                body=body,
            )

        executors["context_get"] = _context_get

    if "context_search" in names:
        def _context_search(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            body: dict[str, Any] = {
                "runId": run_id,
                "query": params.get("query") or "",
            }
            if isinstance(params.get("sources"), list):
                body["sources"] = params["sources"]
            if isinstance(params.get("collectionIds"), list):
                body["collectionIds"] = params["collectionIds"]
            if params.get("maxItems") is not None:
                body["maxItems"] = params["maxItems"]
            if params.get("maxChars") is not None:
                body["maxChars"] = params["maxChars"]
            return _post_context_tool(
                backend_url=backend_url,
                agent_id=agent_id,
                runner_token=runner_token,
                path="search",
                body=body,
            )

        executors["context_search"] = _context_search

    if "state_read" in names:
        def _state_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            body: dict[str, Any] = {"runId": run_id}
            if isinstance(params.get("select"), list):
                body["select"] = params["select"]
            return _post_context_tool(
                backend_url=backend_url,
                agent_id=agent_id,
                runner_token=runner_token,
                path="state/read",
                body=body,
            )

        executors["state_read"] = _state_read

    if "state_patch" in names:
        def _state_patch(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            body: dict[str, Any] = {
                "runId": run_id,
                "baseVersion": params.get("baseVersion"),
                "operations": params.get("operations") or [],
            }
            if params.get("idempotencyKey"):
                body["idempotencyKey"] = params["idempotencyKey"]
            return _post_context_tool(
                backend_url=backend_url,
                agent_id=agent_id,
                runner_token=runner_token,
                path="state/patch",
                body=body,
            )

        executors["state_patch"] = _state_patch

    return executors
