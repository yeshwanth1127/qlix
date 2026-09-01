"""Document tools (cloud + hybrid): generate PDFs and spreadsheets in the runner sandbox.

Gated on ``files.create`` (separate from ``web.research``). Generated files
are uploaded to the Qlix sandbox store and return a shareable download link. To
deliver a file on WhatsApp, pass the returned local runner path to ``whatsapp_send``.
Rendering is a local, no-cost operation — not wrapped in a signed action.
"""

from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Any, Callable

from .identity import AgentIdentity
from .pdf_render import render_markdown_pdf
from .xlsx_render import render_xlsx

# Own scope — not web.research — so document export is grantable independently.
DOCUMENT_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "create_report_pdf": ("files.create",),
    "create_xlsx": ("files.create",),
}

DOCUMENT_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "create_report_pdf": {
        "type": "function",
        "function": {
            "name": "create_report_pdf",
            "description": (
                "Render a finished report to a PDF and return a shareable download link "
                "(plus a local path). Accepts a lightweight Markdown subset: # / ## / ### "
                "headings, **bold**, *italic*, and - bullet lists. Use this to package a "
                "competitor-research or research report as a document. Share the exact "
                "download link it returns with the user — never invent a link or a local "
                "file path (no sandbox: URLs). To also send it over WhatsApp, pass the "
                "returned local path to whatsapp_send."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Report title — shown as the PDF heading and used for the file name.",
                    },
                    "content": {
                        "type": "string",
                        "description": "The full report body as Markdown.",
                    },
                },
                "required": ["title", "content"],
            },
        },
    },
    "create_xlsx": {
        "type": "function",
        "function": {
            "name": "create_xlsx",
            "description": (
                "Create a real Excel .xlsx spreadsheet and return a shareable download link "
                "(plus a local path). Use whenever the user asks for a spreadsheet, Excel "
                "file, or .xlsx export. Provide 'rows' as a list of lists (first row = "
                "headers) or a list of objects (keys become the header row). Share the exact "
                "download link it returns with the user — never invent a link. To also send "
                "it over WhatsApp, pass the returned local path to whatsapp_send."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Used for the file name when generating the spreadsheet.",
                    },
                    "sheet_name": {
                        "type": "string",
                        "description": "Worksheet name (default 'Sheet1').",
                    },
                    "rows": {
                        "type": "array",
                        "description": (
                            "Spreadsheet data: a list of rows where each row is a list of cell "
                            "values, OR a list of objects (keys become the header row)."
                        ),
                        "items": {},
                    },
                },
                "required": ["rows"],
            },
        },
    },
}


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip()).strip("-").lower()
    return slug[:60] or "report"


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def openai_document_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    """Return OpenAI tool defs for document tools allowed by scopes + skill filter."""
    granted = _effective_granted_scopes(identity)
    tool_ids = list(DOCUMENT_TOOL_SCOPES.keys())

    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [
                t for t in tool_ids if any(s in filt for s in DOCUMENT_TOOL_SCOPES.get(t, ()))
            ]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = DOCUMENT_TOOL_SCOPES.get(tid, ())
        if any(s not in granted for s in req):
            continue
        defn = DOCUMENT_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def _upload_sandbox_file(
    path: Path,
    *,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
    content_type: str,
) -> str | None:
    """Upload a generated file to the backend sandbox store; returns a download URL or None."""
    try:
        import httpx

        data = path.read_bytes()
        resp = httpx.post(
            f"{backend_url.rstrip('/')}/api/v1/agents/{agent_id}/runs/{run_id}/sandbox-file",
            headers={
                "X-QLIX-Runner-Token": runner_token,
                "Content-Type": content_type,
                "X-Content-Type": content_type,
                "X-File-Name": path.name,
            },
            content=data,
            timeout=180.0,
        )
        if resp.status_code >= 400:
            return None
        payload = resp.json() if resp.text else {}
        url = payload.get("url") if isinstance(payload, dict) else None
        return str(url) if url else None
    except Exception:
        return None


def _upload_report_pdf(
    path: Path, agent_id: str, run_id: str, backend_url: str, runner_token: str
) -> str | None:
    """Backward-compatible PDF upload (delegates to sandbox-file)."""
    return _upload_sandbox_file(
        path,
        agent_id=agent_id,
        run_id=run_id,
        backend_url=backend_url,
        runner_token=runner_token,
        content_type="application/pdf",
    )


def _format_sandbox_result(
    *,
    kind: str,
    file_name: str,
    local_path: Path,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
    content_type: str,
) -> str:
    parts = [f"{kind} created ({file_name})."]
    if agent_id and run_id and backend_url and runner_token:
        url = _upload_sandbox_file(
            local_path,
            agent_id=agent_id,
            run_id=run_id,
            backend_url=backend_url,
            runner_token=runner_token,
            content_type=content_type,
        )
        if url:
            parts.append(f"Shareable download link (give this to the user, valid ~7 days): {url}")
        else:
            parts.append("Note: could not create a download link — deliver via whatsapp_send instead.")
    parts.append(f"Local path for whatsapp_send: {local_path}")
    return " ".join(parts)


def _parse_report_args(args_json: str) -> tuple[str, str]:
    """Best-effort parse of create_report_pdf arguments → (title, content).

    Weak models often emit invalid JSON for the long ``content`` field (unescaped
    quotes or literal newlines), which would otherwise crash the tool and loop the
    run. Try strict then lenient JSON, then salvage the fields with regex. Never raises.
    """
    s = (args_json or "").strip()
    if not s:
        return "", ""

    for strict in (True, False):  # lenient allows literal control chars in strings
        try:
            data = json.loads(s, strict=strict)
            if isinstance(data, dict):
                return str(data.get("title", "")).strip(), str(data.get("content", "")).strip()
        except Exception:
            pass

    def _unescape(x: str) -> str:
        return (
            x.replace("\\n", "\n").replace("\\t", "\t").replace('\\"', '"').replace("\\\\", "\\")
        )

    title = ""
    mt = re.search(r'"title"\s*:\s*"(.*?)"\s*,\s*"content"\s*:', s, re.DOTALL)
    if mt:
        title = _unescape(mt.group(1)).strip()

    content = ""
    mc = re.search(r'"content"\s*:\s*"(.*)$', s, re.DOTALL)
    if mc:
        content = _unescape(re.sub(r'"\s*\}?\s*$', "", mc.group(1))).strip()

    return title, content


def _parse_xlsx_args(args_json: str) -> tuple[str, str, Any]:
    """Parse create_xlsx arguments → (title, sheet_name, rows). Never raises."""
    s = (args_json or "").strip()
    if not s:
        return "", "Sheet1", None

    for strict in (True, False):
        try:
            data = json.loads(s, strict=strict)
            if isinstance(data, dict):
                return (
                    str(data.get("title", "")).strip(),
                    str(data.get("sheet_name", "Sheet1") or "Sheet1").strip(),
                    data.get("rows"),
                )
        except Exception:
            pass

    title = ""
    mt = re.search(r'"title"\s*:\s*"(.*?)"', s)
    if mt:
        title = mt.group(1).strip()

    sheet_name = "Sheet1"
    ms = re.search(r'"sheet_name"\s*:\s*"(.*?)"', s)
    if ms:
        sheet_name = ms.group(1).strip() or "Sheet1"

    rows: Any = None
    mr = re.search(r'"rows"\s*:\s*(\[.*\])\s*\}?\s*$', s, re.DOTALL)
    if mr:
        try:
            rows = json.loads(mr.group(1))
        except Exception:
            rows = None

    return title, sheet_name, rows


def build_document_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    agent_id: str = "",
    run_id: str = "",
    backend_url: str = "",
    runner_token: str = "",
) -> dict[str, Callable[[str], str]]:
    """Pre-bind document tool executors for the inference loop."""
    executors: dict[str, Callable[[str], str]] = {}
    defs = openai_document_tool_definitions(identity, skill_filter)
    allowed = {d["function"]["name"] for d in defs if isinstance(d.get("function"), dict)}

    if "create_report_pdf" in allowed:

        def _create_report_pdf(args_json: str) -> str:
            title, content = _parse_report_args(args_json)
            if not content:
                return "[failed] content is required"
            out = Path(tempfile.gettempdir()) / f"{_slugify(title or 'report')}.pdf"
            ok, msg = render_markdown_pdf(title=title, content=content, out=out)
            if not ok:
                return f"[failed] {msg}"
            return _format_sandbox_result(
                kind="Report PDF",
                file_name=out.name,
                local_path=out,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
                content_type="application/pdf",
            )

        executors["create_report_pdf"] = _create_report_pdf

    if "create_xlsx" in allowed:

        def _create_xlsx(args_json: str) -> str:
            title, sheet_name, rows = _parse_xlsx_args(args_json)
            if rows is None:
                return "[failed] rows is required"
            out = Path(tempfile.gettempdir()) / f"{_slugify(title or sheet_name or 'spreadsheet')}.xlsx"
            ok, msg = render_xlsx(title=title, rows=rows, sheet_name=sheet_name, out=out)
            if not ok:
                return f"[failed] {msg}"
            return _format_sandbox_result(
                kind="Spreadsheet",
                file_name=out.name,
                local_path=out,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )

        executors["create_xlsx"] = _create_xlsx

    return executors


def is_document_tool(tool_name: str) -> bool:
    return tool_name in DOCUMENT_TOOL_SCOPES
