"""Hybrid local execution via gui-agents S3 (Agent-S3), not Luna tools."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import platform
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Awaitable, Callable

from .agents3_proxy import Agents3RunContext, resolve_s3_engine_params
from .hybrid_cwd import cwd_prompt_line, get_cwd, reset_cwd, set_cwd
from .hybrid_file_ops import apply_replace_patch, apply_v4a_patch, search_files, sensitive_path_blocked
from .identity import AgentIdentity
from .local_environment import get_cached_environment, resolve_local_path
from .shell_policy import assess_shell_command

Agents3Executor = Callable[[str], Awaitable[str]]

TOOL_SCOPE_MAP: dict[str, tuple[str, ...]] = {
    "luna_local_read_file": ("system.file_read",),
    "luna_local_write_file": ("system.file_write",),
    "luna_local_list_dir": ("system.file_read",),
    "luna_local_search_files": ("system.file_read",),
    "luna_local_patch": ("system.file_write",),
    "luna_local_cd": ("system.file_read",),
    "luna_local_pwd": ("system.file_read",),
    "luna_local_bash": ("system.file_write",),
    "luna_local_python": ("system.file_write",),
    "luna_local_code_task": ("system.file_write",),
    "luna_local_open_file": ("system.file_read",),
    "luna_local_create_pdf": ("system.file_write",),
    "luna_local_create_xlsx": ("system.file_write",),
    # Representative scope for JIT labeling only; real availability is the
    # any-of gate below (file_read OR file_write).
    "luna_local_send_whatsapp_document": ("system.file_read",),
    "gui_control": ("system.gui_control",),
}

# Tools available when the agent has ANY of these scopes (not all). Delivering a
# file fits a reader (sends what it read) OR a writer (sends what it created),
# so the WhatsApp send tool is offered with file_read OR file_write.
TOOL_ANY_OF_SCOPES: dict[str, tuple[str, ...]] = {
    "luna_local_send_whatsapp_document": ("system.file_read", "system.file_write"),
}

READ_ONLY_LUNA_LOCAL_TOOLS = frozenset(
    {"luna_local_read_file", "luna_local_list_dir", "luna_local_open_file", "luna_local_search_files", "luna_local_pwd", "luna_local_cd"}
)
WRITE_LUNA_LOCAL_TOOLS = frozenset(
    {
        "luna_local_write_file",
        "luna_local_patch",
        "luna_local_bash",
        "luna_local_python",
        "luna_local_code_task",
        "luna_local_create_pdf",
        "luna_local_create_xlsx",
    }
)

# Binary office/document formats that must NOT be produced by luna_local_write_file (which
# only writes UTF-8 text — doing so yields a corrupt file the app can't open).
_BINARY_DOC_SUFFIXES = {".xlsx", ".xls", ".docx", ".pptx", ".pdf"}

_WRITE_INTENT = re.compile(
    r"\b(write|save|overwrite|append|export|"
    r"create\s+(?:a\s+)?(?:new\s+)?(?:file|pdf|document|doc|report|invoice)|"
    r"make\s+(?:a\s+)?(?:pdf|document|report)|"
    r"generate\s+.*\.(?:txt|log|csv|json|md|pdf|docx|xlsx))\b",
    re.IGNORECASE,
)
_READ_INTENT = re.compile(
    r"\b(read|open|view|show|list|inspect|summarize|summary|review|scan|tail)\b",
    re.IGNORECASE,
)

# A produced/delivered artifact means the task is NOT read-only even when the
# instruction also contains a read verb (e.g. "read the doc and make a pdf").
_OUTPUT_INTENT = re.compile(
    r"\b(pdf|docx|xlsx|spreadsheet|report|invoice|document|"
    r"send|share|deliver|attach|download|export|email|whatsapp)\b",
    re.IGNORECASE,
)


def is_read_only_file_intent(instruction: str) -> bool:
    """True when the user asked to read/open/review files but not create or modify them.

    A request that also produces or delivers an artifact (pdf/report/whatsapp/send/…)
    is never read-only, even if it contains a read verb like "summarize".
    """
    text = (instruction or "").strip()
    if not text:
        return False
    if _WRITE_INTENT.search(text) or _OUTPUT_INTENT.search(text):
        return False
    return _READ_INTENT.search(text) is not None

LOCAL_TOOL_IDS = (
    "luna_local_read_file",
    "luna_local_write_file",
    "luna_local_list_dir",
    "luna_local_search_files",
    "luna_local_patch",
    "luna_local_open_file",
    "luna_local_pwd",
    "luna_local_cd",
    "luna_local_bash",
    "luna_local_python",
    "luna_local_create_pdf",
    "luna_local_create_xlsx",
    "luna_local_send_whatsapp_document",
)
CODE_TOOL_IDS = ("luna_local_bash", "luna_local_python", "luna_local_code_task")
GUI_TOOL_IDS = ("gui_control",)


def _granted(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def _scope_satisfied(
    tid: str, granted: set[str]
) -> tuple[bool, tuple[str, ...], list[str]]:
    """Whether a tool's scope requirement is met.

    Returns (available, scopes_for_filter, missing). Tools in TOOL_ANY_OF_SCOPES
    are available when ANY listed scope is granted; all others require ALL.
    """
    any_of = TOOL_ANY_OF_SCOPES.get(tid)
    if any_of is not None:
        ok = any(s in granted for s in any_of)
        return ok, any_of, [] if ok else list(any_of)
    scopes = TOOL_SCOPE_MAP.get(tid, (tid,))
    missing = [s for s in scopes if s not in granted]
    return not missing, scopes, missing


def _filter_tools(
    tool_ids: tuple[str, ...],
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    *,
    instruction: str | None = None,
) -> list[str]:
    """Tools offered for these ids.

    ``instruction`` is retained only for diagnostics. Passing it makes the result
    prompt-dependent, which is why the schema builders now pass ``None`` — a tool array
    that changes with the wording of a request cannot be cached, and made tool
    availability non-deterministic for a fixed set of scopes.
    """
    granted = _granted(identity)
    out: list[str] = []
    filt = {str(s).strip() for s in (skill_filter or []) if str(s).strip()} if skill_filter else None
    read_only = is_read_only_file_intent(instruction or "")
    for tid in tool_ids:
        if read_only and tid in WRITE_LUNA_LOCAL_TOOLS:
            continue
        available, scopes, _missing = _scope_satisfied(tid, granted)
        if not available:
            continue
        if filt and any("." in s for s in filt):
            if not any(s in filt for s in scopes):
                continue
        elif filt and tid not in filt:
            continue
        out.append(tid)
    return out


def diagnose_local_tools(
    identity: AgentIdentity,
    *,
    groups: tuple[str, ...],
    skill_filter: list[str] | None,
    instruction: str | None,
) -> dict[str, Any]:
    """Explain, per local tool, whether it is offered and (if not) why.

    Used by the runners to emit a debug event so a missing write/PDF tool is no
    longer silent. Mirrors the exact gating used by ``_filter_tools`` /
    ``openai_agents3_tool_definitions`` so the report can't drift from reality.
    """
    granted = _granted(identity)
    read_only = is_read_only_file_intent(instruction or "")
    filt = (
        {str(s).strip() for s in (skill_filter or []) if str(s).strip()}
        if skill_filter
        else None
    )
    scoped_filter = bool(filt and any("." in s for s in filt))

    # Which id pools are in play given the selected groups (matches the
    # openai_agents3_tool_definitions / build_agents3_executors logic).
    candidate_ids: list[str] = []
    if "files" in groups:
        candidate_ids.extend(LOCAL_TOOL_IDS)
    if "code" in groups and not read_only:
        candidate_ids.extend(t for t in CODE_TOOL_IDS if t not in candidate_ids)
    if "gui" in groups:
        candidate_ids.extend(t for t in GUI_TOOL_IDS if t not in candidate_ids)

    decisions: list[dict[str, Any]] = []
    offered: list[str] = []
    for tid in dict.fromkeys(LOCAL_TOOL_IDS + CODE_TOOL_IDS + GUI_TOOL_IDS):
        _available, scopes, missing = _scope_satisfied(tid, granted)
        reason = None
        if tid not in candidate_ids:
            reason = "group_not_selected_or_read_only"
        elif read_only and tid in WRITE_LUNA_LOCAL_TOOLS:
            reason = "blocked_by_read_only_intent"
        elif missing:
            sep = "|" if tid in TOOL_ANY_OF_SCOPES else ","
            reason = f"missing_scope:{sep.join(missing)}"
        elif scoped_filter and not any(s in filt for s in scopes):
            reason = "skill_scope_filter_excluded"
        elif filt and not scoped_filter and tid not in filt:
            reason = "skill_tool_filter_excluded"
        if reason is None:
            offered.append(tid)
        decisions.append({"tool": tid, "offered": reason is None, "reason": reason})

    return {
        "granted_scopes": sorted(granted),
        "read_only_intent": read_only,
        "skill_filter": sorted(filt) if filt else None,
        "groups": list(groups),
        "instruction_preview": (instruction or "")[:200],
        "offered_tools": offered,
        "decisions": decisions,
    }


def _open_path_on_system(
    path: Path,
    *,
    mode: str = "default",
    application: str | None = None,
) -> tuple[bool, str]:
    """Launch file/folder on the user's desktop (native OS UI)."""
    if not path.exists():
        return False, f"Path not found: {path}"

    mode = (mode or "default").strip().lower()
    app = (application or "").strip()
    system = platform.system()

    try:
        if system == "Windows":
            p = str(path.resolve())
            if mode == "folder":
                target = p if path.is_dir() else str(path.parent.resolve())
                proc = subprocess.run(
                    ["explorer.exe", target],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            elif mode == "reveal":
                proc = subprocess.run(
                    ["explorer.exe", "/select,", p],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            elif app:
                proc = subprocess.run(
                    [
                        "powershell",
                        "-NoProfile",
                        "-Command",
                        f"Start-Process -FilePath {json.dumps(app)} -ArgumentList {json.dumps(p)}",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            else:
                proc = subprocess.run(
                    [
                        "powershell",
                        "-NoProfile",
                        "-Command",
                        f"Start-Process -FilePath {json.dumps(p)}",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            if proc.returncode != 0:
                err = (proc.stderr or proc.stdout or "").strip()
                return False, err or f"explorer/Start-Process exited {proc.returncode}"
            return True, f"Opened on screen: {p}"

        if system == "Darwin":
            cmd = ["open"]
            if mode == "reveal":
                cmd.append("-R")
            elif app:
                cmd.extend(["-a", app])
            cmd.append(str(path.resolve()))
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if proc.returncode != 0:
                return False, (proc.stderr or proc.stdout or "").strip()
            return True, f"Opened on screen: {path}"

        # Linux and other Unix
        target = path.resolve()
        if mode == "folder" and path.is_file():
            target = path.parent
        proc = subprocess.run(
            ["xdg-open", str(target)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            return False, (proc.stderr or proc.stdout or "").strip()
        return True, f"Opened on screen: {target}"
    except subprocess.TimeoutExpired:
        return False, "Timed out launching application"
    except Exception as exc:
        return False, str(exc)


def _run_bash(code: str, *, timeout: int = 120) -> dict[str, Any]:
    """Shell on the hybrid host, always in the session cwd."""
    cwd = str(get_cwd())
    try:
        if platform.system() == "Windows":
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", code],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
            )
        else:
            proc = subprocess.run(
                ["/bin/bash", "-lc", code],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
            )
        output = (proc.stdout or "") + (proc.stderr or "")
        return {
            "status": "ok" if proc.returncode == 0 else "error",
            "returncode": proc.returncode,
            "output": output,
            "cwd": cwd,
        }
    except subprocess.TimeoutExpired as exc:
        return {"status": "error", "returncode": -1, "output": "", "error": str(exc), "cwd": cwd}
    except Exception as exc:
        return {"status": "error", "returncode": -1, "output": "", "error": str(exc), "cwd": cwd}


def _run_python(code: str) -> dict[str, Any]:
    try:
        from gui_agents.s3.utils.local_env import LocalEnv

        return LocalEnv().controller.run_python_script(code)
    except ImportError:
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=120,
        )
        return {
            "status": "ok" if proc.returncode == 0 else "error",
            "returncode": proc.returncode,
            "output": (proc.stdout or "") + (proc.stderr or ""),
        }



def _slugify(text: str, *, fallback: str = "document") -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", (text or "")).strip("-")
    return slug[:80] or fallback


def _safe_mkdir_parent(path: Path) -> str | None:
    """Create parent dirs; return an error message instead of raising."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        return None
    except OSError as exc:
        env = get_cached_environment()
        hint = ""
        if env:
            hint = (
                f" Use real paths from this machine (home={env.get('home')}, "
                f"documents={env.get('documents')})."
            )
        return f"Cannot create directory {path.parent}: {exc}.{hint}"


def _local_path(raw: str) -> Path:
    text = (raw or "").strip()
    # Relative / bare paths resolve against hybrid session cwd (Hermes-style).
    if text and not Path(text).expanduser().is_absolute() and not text.startswith("~"):
        from .hybrid_cwd import resolve_against_cwd

        return resolve_against_cwd(text)
    return resolve_local_path(raw, env=get_cached_environment())


def _create_pdf_file(
    *, title: str, content: str, output_path: str | None
) -> tuple[bool, str]:
    """Render text/markdown to a real PDF on the local filesystem.

    Returns ``(ok, message)`` where ``message`` is the absolute path on success
    or an error description on failure.
    """
    import tempfile

    if not (content.strip() or title.strip()):
        return False, "content is required to create a PDF"

    if output_path:
        out = _local_path(output_path)
        if out.suffix.lower() != ".pdf":
            out = out.with_suffix(".pdf")
    else:
        env = get_cached_environment()
        base = Path(env["documents"]) if env and env.get("documents") else Path.home() / "Documents"
        if not base.is_dir():
            base = Path(tempfile.gettempdir())
        out = base / f"{_slugify(title)}.pdf"

    mkdir_err = _safe_mkdir_parent(out)
    if mkdir_err:
        return False, mkdir_err

    from .pdf_render import render_markdown_pdf

    return render_markdown_pdf(title=title, content=content, out=out)


def _create_xlsx_file(
    *, title: str, rows: Any, sheet_name: str, output_path: str | None
) -> tuple[bool, str]:
    """Write a real .xlsx workbook on the user's machine."""
    import tempfile

    from .xlsx_render import render_xlsx

    if output_path:
        out = _local_path(output_path)
    else:
        env = get_cached_environment()
        base = Path(env["documents"]) if env and env.get("documents") else Path.home() / "Documents"
        if not base.is_dir():
            base = Path(tempfile.gettempdir())
        out = base / f"{_slugify(title or sheet_name or 'spreadsheet')}.xlsx"

    mkdir_err = _safe_mkdir_parent(out)
    if mkdir_err:
        return False, mkdir_err

    return render_xlsx(title=title, rows=rows, sheet_name=sheet_name, out=out)


async def _send_whatsapp_document(
    file_path: str,
    file_name: str | None,
    *,
    identity: AgentIdentity,
    agents3_context: Agents3RunContext | None,
) -> str:
    """Deliver a local file to the user's linked WhatsApp via the Qlix backend.

    Reads file bytes on the runner and uploads them as base64 to the backend's
    send-file endpoint — this works for hybrid runners where the runner filesystem
    is not accessible by the backend server.
    """
    if not file_path:
        return "[failed] file_path is required"
    path = Path(file_path).expanduser()
    if not path.is_file():
        return f"[failed] File not found: {path}"

    backend_url, agent_id, runner_token, _ = _s3_run_context(identity, agents3_context)
    if not (backend_url and agent_id and runner_token):
        return (
            "[failed] WhatsApp send is only available for hybrid runs with a runner token "
            "(missing backend_url/agent_id/runner_token)."
        )

    try:
        data = path.read_bytes()
    except OSError as exc:
        return f"[failed] Could not read file: {exc}"
    if not data:
        return "[failed] File is empty"

    effective_name = file_name or path.name
    if not Path(effective_name).suffix and path.suffix:
        effective_name = f"{effective_name}{path.suffix}"
    body: dict[str, Any] = {
        "file_name": effective_name,
        "content_base64": base64.b64encode(data).decode("ascii"),
    }
    run_id = agents3_context.run_id if agents3_context else None
    if run_id:
        body["runId"] = run_id

    url = f"{backend_url.rstrip('/')}/api/v1/agents/{agent_id}/tools/whatsapp/send-file"
    headers = {"X-QLIX-Runner-Token": runner_token, "Content-Type": "application/json"}
    try:
        import httpx

        def _post() -> tuple[int, str]:
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(url, headers=headers, json=body)
                return resp.status_code, resp.text

        status, text = await asyncio.to_thread(_post)
    except Exception as exc:
        return f"[failed] WhatsApp send request error: {exc}"

    if status >= 400:
        try:
            payload = json.loads(text) if text else {}
            err = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(err, dict):
                return f"[failed] {err.get('code', 'error')}: {err.get('message', text[:300])}"
        except json.JSONDecodeError:
            pass
        return f"[failed] HTTP {status}: {text[:300]}"

    return f"Sent {effective_name} to WhatsApp."


def openai_agents3_tool_definitions(
    identity: AgentIdentity,
    *,
    groups: tuple[str, ...],
    skill_filter: list[str] | None = None,
    instruction: str | None = None,
) -> list[dict[str, Any]]:
    """OpenAI tool schemas for hybrid local tools (gui-agents S3 stack)."""
    tools: list[dict[str, Any]] = []
    ids: list[str] = []
    if "files" in groups:
        ids.extend(_filter_tools(LOCAL_TOOL_IDS, identity, skill_filter, instruction=instruction))
    if "code" in groups:
        for tid in _filter_tools(CODE_TOOL_IDS, identity, skill_filter, instruction=instruction):
            if tid not in ids:
                ids.append(tid)
    if "gui" in groups:
        for tid in _filter_tools(GUI_TOOL_IDS, identity, skill_filter, instruction=instruction):
            if tid not in ids:
                ids.append(tid)

    schemas: dict[str, dict[str, Any]] = {
        "luna_local_read_file": {
            "name": "luna_local_read_file",
            "description": (
                "Read a text file on the user's computer. Provide the full absolute path "
                "(e.g. C:\\Users\\...\\file.log on Windows). Use max_lines for large logs; "
                "prefer this over luna_local_python for read-only log review."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to the file."},
                    "max_lines": {"type": "integer", "description": "Optional max lines to return."},
                },
                "required": ["path"],
            },
        },
        "luna_local_write_file": {
            "name": "luna_local_write_file",
            "description": "Write text to a file on the user's computer (overwrite).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
        "luna_local_list_dir": {
            "name": "luna_local_list_dir",
            "description": "List files and folders in a directory on the user's computer.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Absolute or cwd-relative directory path."}},
                "required": ["path"],
            },
        },
        "luna_local_search_files": {
            "name": "luna_local_search_files",
            "description": (
                "Search file contents or find files by name (Hermes search_files). "
                "Prefer this over grep/find in luna_local_bash. target=content for regex in files; "
                "target=files for glob by name."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex for content search, or glob (e.g. '*.py') for file search",
                    },
                    "target": {
                        "type": "string",
                        "enum": ["content", "files"],
                        "description": "content=grep inside files; files=find by name",
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory or file to search (default: session cwd)",
                    },
                    "file_glob": {
                        "type": "string",
                        "description": "Optional glob filter when target=content (e.g. '*.py')",
                    },
                    "limit": {"type": "integer", "description": "Max results (default 50)"},
                    "offset": {"type": "integer", "description": "Skip first N results"},
                    "output_mode": {
                        "type": "string",
                        "enum": ["content", "files_only", "count"],
                        "description": "For content search: matching lines, paths only, or counts",
                    },
                    "context": {
                        "type": "integer",
                        "description": "Context lines around each match (content mode)",
                    },
                },
                "required": ["pattern"],
            },
        },
        "luna_local_patch": {
            "name": "luna_local_patch",
            "description": (
                "Edit files on the host. mode=replace (default): exact old_string→new_string in one file. "
                "mode=patch: Hermes V4A multi-file patch (*** Begin Patch … *** End Patch) with "
                "Add/Update/Delete/Move; validated atomically then applied. Prefer replace for single "
                "surgical edits; use patch for scaffolding or multi-file structural changes. "
                "On failure, re-read and use fuzzy 'Did you mean' hints; after repeated failures use "
                "luna_local_write_file."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["replace", "patch"],
                        "description": "replace=single-file exact swap (default); patch=V4A multi-file body",
                    },
                    "path": {
                        "type": "string",
                        "description": "File to patch (replace mode; absolute or cwd-relative)",
                    },
                    "old_string": {"type": "string", "description": "Exact text to find (replace mode)"},
                    "new_string": {"type": "string", "description": "Replacement text (replace mode)"},
                    "replace_all": {
                        "type": "boolean",
                        "description": "Replace every occurrence (replace mode; default false)",
                    },
                    "patch": {
                        "type": "string",
                        "description": (
                            "V4A patch body (mode=patch). Example:\n"
                            "*** Begin Patch\n*** Add File: src/main.py\n+print('hi')\n"
                            "*** Update File: README.md\n@@\n-# Old\n+# New\n*** End Patch"
                        ),
                    },
                },
                "required": [],
            },
        },
        "luna_local_pwd": {
            "name": "luna_local_pwd",
            "description": "Return the hybrid session working directory used for relative paths and luna_local_bash.",
            "parameters": {"type": "object", "properties": {}},
        },
        "luna_local_cd": {
            "name": "luna_local_cd",
            "description": (
                "Change the hybrid session working directory. Relative paths for file tools and "
                "luna_local_bash use this cwd afterward. Prefer this over `cd` inside luna_local_bash (subshell)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory to make the new session cwd"},
                },
                "required": ["path"],
            },
        },
        "luna_local_open_file": {
            "name": "luna_local_open_file",
            "description": (
                "Open a file or folder on the user's computer with the default app or File Explorer "
                "(like remote desktop — windows appear on their screen, not in Qlix). "
                "Use mode 'folder' to open a directory in Explorer/Finder; 'reveal' to highlight a file in its folder."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to file or folder."},
                    "mode": {
                        "type": "string",
                        "enum": ["default", "folder", "reveal"],
                        "description": "default=launch with associated app; folder=open directory; reveal=show in file manager.",
                    },
                    "application": {
                        "type": "string",
                        "description": "Optional app name or path (e.g. notepad, code, excel). Windows only.",
                    },
                },
                "required": ["path"],
            },
        },
        "luna_local_bash": {
            "name": "luna_local_bash",
            "description": (
                "Run a shell command in the session cwd (PowerShell on Windows, bash on Mac/Linux). "
                "Safe inspect commands (ls, git status, …) run without approval; destructive or "
                "unknown commands require JIT. Prefer luna_local_search_files / luna_local_patch for file work; "
                "use luna_local_cd to change cwd (cd in a subshell does not persist)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "timeout_seconds": {"type": "integer"},
                },
                "required": ["command"],
            },
        },
        "luna_local_python": {
            "name": "luna_local_python",
            "description": "Run a short Python snippet locally via Agent-S3 LocalEnv.",
            "parameters": {
                "type": "object",
                "properties": {"code": {"type": "string"}},
                "required": ["code"],
            },
        },
        "luna_local_create_pdf": {
            "name": "luna_local_create_pdf",
            "description": (
                "Create a real PDF file on the user's computer from text or markdown. "
                "Use this whenever the user asks to 'create/make/generate a PDF' or document — "
                "do NOT tell the user to copy-paste into Word. Supports markdown headings "
                "(#, ##, ###) and bullet lines ('- ' or '* '). Returns the absolute path of "
                "the created PDF, which you can then pass to luna_local_send_whatsapp_document."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Document title (rendered at the top)."},
                    "content": {
                        "type": "string",
                        "description": "Body text or markdown for the PDF.",
                    },
                    "output_path": {
                        "type": "string",
                        "description": (
                            "Optional absolute path for the .pdf. If omitted, it is saved to the "
                            "user's Documents folder using a slug of the title."
                        ),
                    },
                },
                "required": ["content"],
            },
        },
        "luna_local_create_xlsx": {
            "name": "luna_local_create_xlsx",
            "description": (
                "Create a real Excel .xlsx spreadsheet on the user's computer. Use this "
                "whenever the user asks for a spreadsheet/Excel/xlsx file — do NOT use "
                "luna_local_write_file for .xlsx (that produces a corrupt file Excel cannot open). "
                "Provide 'rows' as a list of lists (first row = headers) or a list of objects. "
                "Returns the absolute path, which you can pass to luna_local_send_whatsapp_document."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Used for the filename when output_path is omitted."},
                    "sheet_name": {"type": "string", "description": "Worksheet name (default 'Sheet1')."},
                    "rows": {
                        "type": "array",
                        "description": (
                            "Spreadsheet data: a list of rows where each row is a list of cell "
                            "values, OR a list of objects (keys become the header row)."
                        ),
                        "items": {},
                    },
                    "output_path": {
                        "type": "string",
                        "description": (
                            "Optional absolute path for the .xlsx. If omitted, saved to the user's "
                            "Documents folder using a slug of the title."
                        ),
                    },
                },
                "required": ["rows"],
            },
        },
        "luna_local_send_whatsapp_document": {
            "name": "luna_local_send_whatsapp_document",
            "description": (
                "Send a local file (e.g. a PDF created with luna_local_create_pdf) to the user's "
                "linked WhatsApp. Provide the absolute file_path. Use after creating a document "
                "when the user asked to send it on WhatsApp."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Absolute path to the file to send.",
                    },
                    "file_name": {
                        "type": "string",
                        "description": "Optional display name for the document in WhatsApp.",
                    },
                },
                "required": ["file_path"],
            },
        },
        "luna_local_code_task": {
            "name": "luna_local_code_task",
            "description": (
                "Run a multi-step coding subtask via Agent-S3 CodeAgent (bash/python). "
                "Use for spreadsheet/doc automation; requires local LLM API keys."
            ),
            "parameters": {
                "type": "object",
                "properties": {"task": {"type": "string"}},
                "required": ["task"],
            },
        },
        "gui_control": {
            "name": "gui_control",
            "description": (
                "Control desktop apps via Agent-S3 (screenshot + UI actions). "
                "Use for native apps; prefer luna_local_read_file / luna_local_bash for files."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string"},
                    "max_steps": {"type": "integer"},
                },
                "required": ["goal"],
            },
        },
    }

    for tid in ids:
        spec = schemas.get(tid)
        if spec:
            tools.append({"type": "function", "function": spec})
    return tools


def build_agents3_executors(
    identity: AgentIdentity,
    *,
    groups: tuple[str, ...],
    qlix_sdk: Any,
    skill_filter: list[str] | None = None,
    agents3_context: Agents3RunContext | None = None,
    instruction: str | None = None,
    read_only_run: bool = False,
) -> dict[str, Agents3Executor]:
    """Async executors; must run on the hybrid runner event loop.

    ``read_only_run`` refuses write tools at execution time rather than hiding them
    from the schema, so the tool array stays identical across runs (and therefore
    cacheable) while the safety property gets *stronger*: previously a write tool
    omitted from the schema was still reachable through ``call_tool``.
    """
    executors: dict[str, Agents3Executor] = {}
    tool_ids: list[str] = []
    code_ids: tuple[str, ...] = CODE_TOOL_IDS
    if "files" in groups or code_ids or "gui" in groups:
        tool_ids = list(
            dict.fromkeys(
                _filter_tools(
                    tuple(
                        LOCAL_TOOL_IDS
                        + code_ids
                        + (GUI_TOOL_IDS if "gui" in groups else ())
                    ),
                    identity,
                    skill_filter,
                    instruction=None,
                )
            )
        )
    granted = _granted(identity)
    for tid in tool_ids:
        any_of = TOOL_ANY_OF_SCOPES.get(tid)
        if any_of is not None:
            # Label the JIT approval under a scope the agent actually holds.
            action_type = next((s for s in any_of if s in granted), any_of[0])
        else:
            action_type = TOOL_SCOPE_MAP.get(tid, (tid,))[0]
        risk = "high" if tid in (
            "luna_local_bash",
            "luna_local_write_file",
            "luna_local_patch",
            "luna_local_python",
            "luna_local_code_task",
            "gui_control",
        ) else "low"

        def _make(tid: str = tid, act: str = action_type, r: str = risk) -> Agents3Executor:
            async def _execute(args_json: str) -> str:
                if read_only_run and tid in WRITE_LUNA_LOCAL_TOOLS:
                    return (
                        f"[failed] blocked: this request was classified as read-only, so "
                        f"{tid} is not permitted. Inspect and report instead. If the user "
                        f"actually wants a file created or changed, ask them to confirm."
                    )
                try:
                    params = json.loads(args_json) if args_json.strip() else {}
                except json.JSONDecodeError:
                    params = {}
                if not isinstance(params, dict):
                    params = {}

                async def _run() -> str:
                    return await _dispatch_agents3_tool(
                        tid, params, identity=identity, agents3_context=agents3_context
                    )

                # Command-level shell policy: safe bash skips blanket file_write JIT.
                if tid == "luna_local_bash":
                    policy = assess_shell_command(str(params.get("command") or ""))
                    if policy.decision == "deny":
                        return f"[failed] shell_denied: {policy.reason}"
                    if policy.decision == "allow" or qlix_sdk is None:
                        return await _run()
                    # approve → JIT via system.file_write
                    run_id = (agents3_context.run_id if agents3_context else None) or ""
                    payload: dict[str, Any] = {
                        "tool": tid,
                        "command": params.get("command"),
                        "policyReason": policy.reason,
                    }
                    if run_id:
                        payload["runId"] = run_id
                    result = await qlix_sdk.run(act, payload, _run, risk_level="high")
                    return str(result)

                if qlix_sdk is None:
                    return await _run()
                # Read-only / cwd tools never need JIT.
                if tid in READ_ONLY_LUNA_LOCAL_TOOLS:
                    return await _run()
                run_id = (agents3_context.run_id if agents3_context else None) or ""
                payload = {"tool": tid, **params}
                if run_id:
                    payload["runId"] = run_id
                result = await qlix_sdk.run(
                    act,
                    payload,
                    _run,
                    risk_level=r,
                )
                return str(result)

            return _execute

        executors[tid] = _make()

    return executors


async def _emit_agents3_log(
    agents3_context: Agents3RunContext | None,
    payload: dict[str, Any],
) -> None:
    """Best-effort live-tool telemetry. Never fail the tool on emit errors
    (e.g. nginx 503 rate-limit while posting /runs/.../event).
    """
    if agents3_context is None or agents3_context.log_emit is None:
        return
    try:
        await agents3_context.log_emit(payload)
    except Exception:
        # Telemetry must not abort luna_local_write_file / bash / etc.
        return


async def _dispatch_agents3_tool(
    tool_id: str,
    params: dict[str, Any],
    *,
    identity: AgentIdentity,
    agents3_context: Agents3RunContext | None = None,
) -> str:
    if tool_id in LOCAL_TOOL_IDS:
        await _emit_agents3_log(
            agents3_context,
            {
                "message": "agents3_step",
                "tool": tool_id,
                "phase": "execute",
                "detail": str(
                    params.get("path")
                    or params.get("command")
                    or (
                        f"mode=patch ({len(str(params.get('patch') or ''))} chars)"
                        if params.get("mode") == "patch"
                        else ""
                    )
                    or ""
                )[:120],
            },
        )

    if tool_id == "luna_local_read_file":
        path = _local_path(str(params.get("path", "")))
        if not path.is_file():
            return f"[failed] File not found: {path}"
        text = path.read_text(encoding="utf-8", errors="replace")
        max_lines = params.get("max_lines")
        if max_lines and int(max_lines) > 0:
            text = "".join(text.splitlines(keepends=True)[: int(max_lines)])
        try:
            from .file_read_state import note_file_read

            note_file_read(path)
        except Exception:
            pass
        return text

    if tool_id == "luna_local_write_file":
        path = _local_path(str(params.get("path", "")))
        blocked = sensitive_path_blocked(path)
        if blocked:
            return f"[failed] {blocked}"
        suffix = path.suffix.lower()
        if suffix in _BINARY_DOC_SUFFIXES:
            tool_hint = (
                "luna_local_create_pdf"
                if suffix == ".pdf"
                else "luna_local_create_xlsx"
                if suffix in (".xlsx", ".xls")
                else "a dedicated document tool"
            )
            return (
                f"[failed] Cannot write a {suffix} file with luna_local_write_file — it only writes "
                f"plain text, which produces a corrupt {suffix} the application cannot open. "
                f"Use {tool_hint} instead."
            )
        mkdir_err = _safe_mkdir_parent(path)
        if mkdir_err:
            return f"[failed] {mkdir_err}"
        try:
            path.write_text(str(params.get("content", "")), encoding="utf-8")
        except OSError as exc:
            return f"[failed] Cannot write {path}: {exc}"
        return (
            f"Wrote file: {path.resolve()}"
            " — If the user asked to send/deliver this file (e.g. on WhatsApp), "
            "call luna_local_send_whatsapp_document now with file_path set to the path above."
        )

    if tool_id == "luna_local_patch":
        mode = str(params.get("mode") or "replace").strip().lower()
        run_id = agents3_context.run_id if agents3_context else None
        if mode == "patch":
            return apply_v4a_patch(str(params.get("patch") or ""), run_id=run_id)
        path = str(params.get("path") or "")
        if not path:
            return "[failed] path is required for mode=replace"
        blocked = sensitive_path_blocked(_local_path(path))
        if blocked:
            return f"[failed] {blocked}"
        return apply_replace_patch(
            path=path,
            old_string=str(params.get("old_string") or ""),
            new_string=str(params.get("new_string") if params.get("new_string") is not None else ""),
            replace_all=bool(params.get("replace_all")),
            run_id=run_id,
        )

    if tool_id == "luna_local_search_files":
        return search_files(
            pattern=str(params.get("pattern") or ""),
            target=str(params.get("target") or "content"),
            path=str(params.get("path") or "."),
            file_glob=str(params["file_glob"]) if params.get("file_glob") else None,
            limit=int(params.get("limit") or 50),
            offset=int(params.get("offset") or 0),
            output_mode=str(params.get("output_mode") or "content"),
            context=int(params.get("context") or 0),
        )

    if tool_id == "luna_local_pwd":
        return str(get_cwd())

    if tool_id == "luna_local_cd":
        try:
            new_cwd = set_cwd(str(params.get("path") or ""))
        except (OSError, NotADirectoryError, ValueError) as exc:
            return f"[failed] {exc}"
        return f"cwd set to {new_cwd}"

    if tool_id == "luna_local_list_dir":
        path = _local_path(str(params.get("path", "")))
        if not path.is_dir():
            return f"[failed] Not a directory: {path}"
        entries = []
        for p in sorted(path.iterdir())[:200]:
            kind = "dir" if p.is_dir() else "file"
            entries.append(f"{kind}\t{p.name}")
        return "\n".join(entries) if entries else "(empty directory)"

    if tool_id == "luna_local_open_file":
        path = _local_path(str(params.get("path", "")))
        mode = str(params.get("mode") or "default")
        application = str(params.get("application") or "").strip() or None
        await _emit_agents3_log(
            agents3_context,
            {
                "message": "agents3_step",
                "tool": "luna_local_open_file",
                "phase": "open",
                "detail": f"{mode}: {path}",
            },
        )
        ok, msg = _open_path_on_system(path, mode=mode, application=application)
        return msg if ok else f"[failed] {msg}"

    if tool_id == "luna_local_bash":
        timeout = int(params.get("timeout_seconds") or 120)
        result = _run_bash(str(params.get("command", "")), timeout=timeout)
        out = result.get("output") or result.get("error") or ""
        prefix = "" if result.get("status") == "ok" else "[failed] "
        cwd_note = f"\n[cwd={result.get('cwd', '')}]" if result.get("cwd") else ""
        return prefix + str(out) + cwd_note

    if tool_id == "luna_local_python":
        result = _run_python(str(params.get("code", "")))
        out = (result.get("output") or "") + (result.get("error") or "")
        prefix = "" if result.get("status") == "ok" else "[failed] "
        return prefix + str(out)

    if tool_id == "luna_local_create_pdf":
        ok, msg = _create_pdf_file(
            title=str(params.get("title") or ""),
            content=str(params.get("content") or ""),
            output_path=str(params.get("output_path") or "").strip() or None,
        )
        await _emit_agents3_log(
            agents3_context,
            {
                "message": "agents3_step",
                "tool": "luna_local_create_pdf",
                "phase": "write",
                "detail": msg[:160],
            },
        )
        if not ok:
            return f"[failed] {msg}"
        return (
            msg
            + " — If the user asked to send/deliver this file (e.g. on WhatsApp), "
            "call luna_local_send_whatsapp_document now with file_path set to the path above."
        )

    if tool_id == "luna_local_create_xlsx":
        ok, msg = _create_xlsx_file(
            title=str(params.get("title") or ""),
            rows=params.get("rows"),
            sheet_name=str(params.get("sheet_name") or "Sheet1"),
            output_path=str(params.get("output_path") or "").strip() or None,
        )
        await _emit_agents3_log(
            agents3_context,
            {
                "message": "agents3_step",
                "tool": "luna_local_create_xlsx",
                "phase": "write",
                "detail": msg[:160],
            },
        )
        if not ok:
            return f"[failed] {msg}"
        return (
            msg
            + " — If the user asked to send/deliver this file (e.g. on WhatsApp), "
            "call luna_local_send_whatsapp_document now with file_path set to the path above."
        )

    if tool_id == "luna_local_send_whatsapp_document":
        file_path = str(params.get("file_path") or "").strip()
        file_name = str(params.get("file_name") or "").strip() or None
        await _emit_agents3_log(
            agents3_context,
            {
                "message": "agents3_step",
                "tool": "luna_local_send_whatsapp_document",
                "phase": "send",
                "detail": file_path[:160],
            },
        )
        return await _send_whatsapp_document(
            file_path,
            file_name,
            identity=identity,
            agents3_context=agents3_context,
        )

    if tool_id == "luna_local_code_task":
        await _emit_agents3_log(
            agents3_context,
            {
                "message": "agents3_step",
                "tool": "luna_local_code_task",
                "phase": "start",
                "detail": (str(params.get("task", ""))[:120] or "CodeAgent task"),
            },
        )
        return await _run_luna_local_code_task(
            str(params.get("task", "")),
            identity=identity,
            agents3_context=agents3_context,
        )

    if tool_id == "gui_control":
        await _emit_agents3_log(
            agents3_context,
            {
                "message": "agents3_step",
                "tool": "gui_control",
                "phase": "start",
                "detail": (str(params.get("goal", ""))[:120] or "Desktop control"),
            },
        )
        return await _run_gui_control(
            str(params.get("goal", "")),
            int(params.get("max_steps") or 8),
            identity=identity,
            agents3_context=agents3_context,
        )

    return f"[failed] Unknown tool: {tool_id}"


def _s3_run_context(
    identity: AgentIdentity,
    agents3_context: Agents3RunContext | None,
) -> tuple[str, str, str, str]:
    agent_id = agents3_context.agent_id if agents3_context else identity.agent_id
    runner_token = agents3_context.runner_token if agents3_context else ""
    model = (
        agents3_context.model
        if agents3_context and agents3_context.model.strip()
        else os.environ.get("QLIX_PROXY_MODEL", "openrouter/openai/gpt-4o-mini")
    )
    return identity.backend_url, agent_id, runner_token, model


async def _run_luna_local_code_task(
    task: str,
    *,
    identity: AgentIdentity,
    agents3_context: Agents3RunContext | None,
) -> str:
    if not task.strip():
        return "[failed] task is required"
    try:
        import os

        from gui_agents.s3.agents.code_agent import CodeAgent
        from gui_agents.s3.utils.local_env import LocalEnv
    except ImportError:
        return "[failed] pip install gui-agents (Agent-S3)"

    backend_url, agent_id, runner_token, model = _s3_run_context(identity, agents3_context)
    engine_params, _ = resolve_s3_engine_params(
        identity.llm_mode,
        backend_url=backend_url,
        agent_id=agent_id,
        runner_token=runner_token,
        model=model,
    )
    env = LocalEnv()
    agent = CodeAgent(engine_params=engine_params, budget=int(os.environ.get("QLIX_S3_CODE_BUDGET", "8")))
    try:
        result = await asyncio.to_thread(agent.execute, task, "", env.controller)
    except Exception as exc:
        msg = str(exc)
        if "inference_not_configured" in msg or "OPENROUTER" in msg.upper():
            return (
                "[failed] Qlix inference proxy is not configured on the server "
                "(OPENROUTER_API_KEY). Contact your administrator."
            )
        return f"[failed] {msg}"
    summary = result.get("summary") or result.get("completion_reason") or str(result)
    return str(summary)


async def _run_gui_control(
    goal: str,
    max_steps: int,
    *,
    identity: AgentIdentity,
    agents3_context: Agents3RunContext | None,
) -> str:
    if not goal.strip():
        return "[failed] goal is required"
    try:
        import os

        import pyautogui  # type: ignore[import-untyped]
        from gui_agents.s3.agents.agent_s import AgentS3
        from gui_agents.s3.agents.grounding import OSWorldACI
    except ImportError:
        return "[failed] pip install gui-agents pyautogui for desktop control"

    backend_url, agent_id, runner_token, model = _s3_run_context(identity, agents3_context)
    grounding_model = os.environ.get("QLIX_S3_GROUNDING_MODEL", "").strip() or None
    engine_params, grounding_params = resolve_s3_engine_params(
        identity.llm_mode,
        backend_url=backend_url,
        agent_id=agent_id,
        runner_token=runner_token,
        model=model,
        grounding_model=grounding_model,
    )
    grounding = OSWorldACI(
        env=None,
        platform=platform.system().lower(),
        engine_params_for_generation=engine_params,
        engine_params_for_grounding=grounding_params,
        width=int(os.environ.get("QLIX_S3_SCREEN_WIDTH", "1920")),
        height=int(os.environ.get("QLIX_S3_SCREEN_HEIGHT", "1080")),
    )
    agent = AgentS3(engine_params, grounding, platform=platform.system().lower())
    max_steps = max(1, min(max_steps, 20))
    last_actions: list[str] = []

    try:
        for step_idx in range(max_steps):
            await _emit_agents3_log(
                agents3_context,
                {
                    "message": "agents3_step",
                    "tool": "gui_control",
                    "phase": "predict",
                    "step": step_idx + 1,
                    "max_steps": max_steps,
                    "detail": "Screenshot + UI action",
                },
            )
            screenshot = pyautogui.screenshot()
            buf = __import__("io").BytesIO()
            screenshot.save(buf, format="PNG")
            import base64

            obs = {"screenshot": base64.b64encode(buf.getvalue()).decode("ascii")}
            _, actions = await asyncio.to_thread(agent.predict, goal, obs)
            last_actions = actions or []
            if any("done" in str(a).lower() or "fail" in str(a).lower() for a in last_actions):
                break
    except Exception as exc:
        msg = str(exc)
        if "inference_not_configured" in msg or "OPENROUTER" in msg.upper():
            return (
                "[failed] Qlix inference proxy is not configured on the server "
                "(OPENROUTER_API_KEY). Contact your administrator."
            )
        return f"[failed] {msg}"

    return "Agent-S3 steps completed. Last actions: " + "; ".join(map(str, last_actions[:5]))
