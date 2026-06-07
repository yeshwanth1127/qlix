"""Deterministic fallback when the LLM stalls after read on PDF/WhatsApp tasks."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Awaitable, Callable

Agents3Executor = Callable[[str], Awaitable[str]]


def wants_pdf_output(prompt: str) -> bool:
    text = (prompt or "").lower()
    return bool(
        re.search(r"\b(create|make|generate|build|export)\b", text)
        and re.search(r"\b(pdf|document|report)\b", text)
    )


def wants_whatsapp_delivery(prompt: str) -> bool:
    return bool(re.search(r"\bwhatsapp\b", (prompt or ""), re.IGNORECASE))


def resolve_source_path(prompt: str) -> Path | None:
    """Best-effort path from a natural-language hybrid prompt."""
    text = prompt or ""
    # Windows absolute path ending in a file extension
    win = re.search(
        r"([A-Za-z]:\\(?:[^\\/\s\"'<>|]+\\)*[^\\/\s\"'<>|]+\.(?:md|txt|markdown|doc|docx|pdf))",
        text,
        re.IGNORECASE,
    )
    if win:
        return Path(win.group(1))
    # "at D:\dir ... file called name.md"
    dir_m = re.search(r"\bat\s+([A-Za-z]:\\[^\s\"'<>|]+)", text, re.IGNORECASE)
    name_m = re.search(
        r"\b(?:file\s+(?:called|named)|called)\s+([^\s\"'<>|/\\]+\.(?:md|txt|markdown))",
        text,
        re.IGNORECASE,
    )
    if dir_m and name_m:
        return Path(dir_m.group(1).rstrip("\\/")) / name_m.group(1)
    # Bare filename with common docs folder hint
    bare = re.search(r"\b([^\s\"'<>|/\\]+\.(?:md|txt|markdown))\b", text, re.IGNORECASE)
    if bare:
        name = bare.group(1)
        for base in (Path.cwd() / "documents", Path.home() / "Documents"):
            candidate = base / name
            if candidate.is_file():
                return candidate
    return None


def _pdf_path_from_tool_result(result: str) -> str | None:
    m = re.search(r"Created PDF:\s*(.+)", result, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


async def run_document_pipeline_fallback(
    *,
    prompt: str,
    tools_executed: list[str],
    tool_executors: dict[str, Agents3Executor],
    log: Callable[..., None] | None = None,
) -> tuple[list[str], str]:
    """Run create/send steps the model skipped. Returns (extra_tool_names, summary)."""
    if "s3_read_file" not in tools_executed:
        return [], ""
    if not wants_pdf_output(prompt) and not wants_whatsapp_delivery(prompt):
        return [], ""

    extra: list[str] = []
    parts: list[str] = []

    source = resolve_source_path(prompt)
    body = ""
    title = "Document"
    if source and source.is_file():
        body = source.read_text(encoding="utf-8", errors="replace")
        title = source.stem.replace("_", " ").replace("-", " ").strip() or title
    elif not source:
        if log:
            log("pipeline_fallback_skip", reason="no_source_path")
        return [], ""
    else:
        if log:
            log("pipeline_fallback_skip", reason="source_not_found", path=str(source))
        return [], ""

    pdf_path: str | None = None

    if wants_pdf_output(prompt) and "s3_create_pdf" not in tools_executed:
        create_fn = tool_executors.get("s3_create_pdf")
        if create_fn:
            if log:
                log("pipeline_fallback", step="s3_create_pdf", title=title)
            create_args = json.dumps({"title": title, "content": body})
            create_out = await create_fn(create_args)
            extra.append("s3_create_pdf")
            parts.append(create_out)
            if create_out.startswith("[failed]"):
                return extra, create_out
            pdf_path = _pdf_path_from_tool_result(create_out)

    if wants_whatsapp_delivery(prompt) and "s3_send_whatsapp_document" not in tools_executed:
        send_fn = tool_executors.get("s3_send_whatsapp_document")
        if send_fn and pdf_path:
            if log:
                log("pipeline_fallback", step="s3_send_whatsapp_document", path=pdf_path[:120])
            send_out = await send_fn(json.dumps({"file_path": pdf_path, "file_name": f"{title}.pdf"}))
            extra.append("s3_send_whatsapp_document")
            parts.append(send_out)

    if not extra:
        return [], ""

    summary = "\n".join(p for p in parts if p.strip())
    if summary and not summary.startswith("[failed]"):
        summary = (
            "Completed remaining steps automatically (the model stopped after reading):\n"
            + summary
        )
    return extra, summary
