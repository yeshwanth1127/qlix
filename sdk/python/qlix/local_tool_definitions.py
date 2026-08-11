"""OpenAI tool definitions for hybrid-local tool groups (FILES, CODE, KNOWLEDGE, ALWAYS)."""

from __future__ import annotations

import platform
from typing import Any

from .identity import AgentIdentity
from .luna.core.registry import ToolRegistry

TOOL_SCOPE_MAP: dict[str, tuple[str, ...]] = {
    "file_read": ("system.file_read",),
    "file_write": ("system.file_write",),
    "apply_patch": ("system.file_write",),
    "git_status": ("system.file_read",),
    "git_diff": ("system.file_read",),
    "git_commit": ("system.file_write",),
    "shell_exec": ("system.file_write",),
    "code_interpreter": ("system.file_read",),
    "http_request": ("system.file_read",),
    "web_search": ("system.file_read",),
}

FILE_TOOL_IDS = ("file_read", "file_write", "apply_patch", "git_tool")
CODE_TOOL_IDS = ("shell_exec", "code_interpreter", "http_request", "web_search")


def _granted(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def _filter_tool_ids(
    ids: tuple[str, ...],
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[str]:
    granted = _granted(identity)
    out: list[str] = []
    for tid in ids:
        scopes = TOOL_SCOPE_MAP.get(tid, (tid,))
        if any(s not in granted for s in scopes):
            continue
        if skill_filter:
            filt = {str(s).strip() for s in skill_filter if str(s).strip()}
            if any("." in s for s in filt):
                if not any(s in filt for s in scopes):
                    continue
            elif tid not in filt:
                continue
        out.append(tid)
    return out


def _tool_def_from_registry(tool_id: str) -> dict[str, Any] | None:
    try:
        cls = ToolRegistry.get(tool_id)
        return cls().to_openai_function()
    except KeyError:
        return None


def openai_file_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    ids = _filter_tool_ids(FILE_TOOL_IDS, identity, skill_filter)
    tools: list[dict[str, Any]] = []
    for tid in ids:
        if tid == "git_tool":
            for sub in ("git_status", "git_diff", "git_commit"):
                d = _tool_def_from_registry(sub)
                if d:
                    tools.append(d)
            continue
        d = _tool_def_from_registry(tid)
        if d:
            if tid == "file_read":
                d["function"]["description"] = (
                    "Read a file from the user's local filesystem. "
                    "Faster than gui_control for file content — prefer this over opening an app to read a file."
                )
            if tid == "file_write":
                d["function"]["description"] = (
                    "Write or append to a file on the user's local machine. "
                    "Requires approval when configured as JIT scope."
                )
            tools.append(d)
    return tools


def openai_code_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    ids = _filter_tool_ids(CODE_TOOL_IDS, identity, skill_filter)
    tools: list[dict[str, Any]] = []
    shell_hint = "powershell" if platform.system() == "Windows" else "bash"
    for tid in ids:
        d = _tool_def_from_registry(tid)
        if not d:
            continue
        if tid == "shell_exec":
            d["function"]["description"] = (
                f"Run a {shell_hint} command on the user's computer and return stdout/stderr. "
                "Faster than gui_control for scripting. Commands must be valid for the host OS."
            )
        tools.append(d)
    return tools


def openai_knowledge_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    granted = _granted(identity)
    if "brain.query" not in granted:
        return []
    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt) and "brain.query" not in filt:
            return []
    return [
        {
            "type": "function",
            "function": {
                "name": "brain_query",
                "description": (
                    "Query the organization AI brain for policies and internal knowledge. "
                    "Context is also injected automatically when enabled for the run."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string", "description": "Question to search internal knowledge."},
                    },
                    "required": ["question"],
                },
            },
        }
    ]


def openai_always_tool_definitions(
    askable_agents: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    from .subagents import openai_subagent_tool_definitions

    return [
        {
            "type": "function",
            "function": {
                "name": "think",
                "description": "Record a reasoning step without executing an external action.",
                "parameters": {
                    "type": "object",
                    "properties": {"thought": {"type": "string"}},
                    "required": ["thought"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "done",
                "description": "Signal that the task is complete when no further tools are needed.",
                "parameters": {
                    "type": "object",
                    "properties": {"summary": {"type": "string"}},
                    "required": ["summary"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "find_tools",
                "description": (
                    "Search the expanded tool catalog (MCP + browser_ab_* + connectors) when "
                    "the default tool list is too large. Returns matching tool names and short docs."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Keyword or substring to search tool names/descriptions",
                        },
                        "limit": {"type": "integer", "description": "Max results (default 15)"},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "call_tool",
                "description": (
                    "Invoke a tool discovered via find_tools by exact name. "
                    "Use when the tool is not in the default visible set."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Exact tool name"},
                        "arguments": {
                            "type": "object",
                            "description": "JSON arguments for the tool",
                        },
                    },
                    "required": ["name"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "delegate_task",
                "description": (
                    "DEPRECATED: prefer spawn_subagents. Fire-and-forget child AgentRun on the "
                    "same agent (cannot safely await — runner deadlock). Returns the child run id."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string", "description": "Subtask instructions"},
                        "skills": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional skill/scope filter for the child",
                        },
                    },
                    "required": ["prompt"],
                },
            },
        },
        *openai_subagent_tool_definitions(askable_agents),
    ]
