"""Outcome verification + deterministic completion for hybrid runs.

Instead of hardcoding one document flow (read -> pdf -> send), we derive the
*outcomes* a prompt requires and verify them against what actually happened at
runtime. If a requested outcome is unmet but we have the material to satisfy it
(e.g. a file was created and the user asked for WhatsApp delivery), we complete
it deterministically rather than relying on a weak model to remember the step.

This keys off runtime state (the actual path a create-tool wrote, whatever its
type) rather than a fixed step sequence, so it generalizes across flows:
generate->xlsx->send, read->pdf->send, etc.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Awaitable, Callable

Agents3Executor = Callable[[str], Awaitable[str]]

# An executed-tool record threaded out of the inference loop.
ExecutedTool = dict[str, str]  # {"name", "args", "output"}


def wants_pdf_output(prompt: str) -> bool:
    text = (prompt or "").lower()
    return bool(
        re.search(r"\b(create|make|generate|build|export|write)\b", text)
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


# Markers emitted by dedicated document tools — these are deliverables the user
# most likely wants sent, so they take precedence over incidental writes.
_ARTIFACT_MARKERS = (
    re.compile(r"Created PDF:\s*(.+)", re.IGNORECASE),
    re.compile(r"Created spreadsheet:\s*(.+)", re.IGNORECASE),
    re.compile(r"Created document:\s*(.+)", re.IGNORECASE),
)
# Generic file writes (s3_write_file). Lets the safety-net deliver any file type
# (.csv/.png/.json/…), but only when no dedicated artifact was produced, so a
# scratch write doesn't get sent instead of the real deliverable.
_WRITE_MARKERS = (re.compile(r"Wrote file:\s*(.+)", re.IGNORECASE),)
_CREATED_MARKERS = _ARTIFACT_MARKERS + _WRITE_MARKERS


def _match_markers(output: str, markers: tuple[re.Pattern[str], ...]) -> str | None:
    for marker in markers:
        m = marker.search(output or "")
        if m:
            path = m.group(1).strip().splitlines()[0].strip()
            # Drop a trailing " — If the user…" next-step hint if present.
            path = re.split(r"\s+—\s", path)[0].strip()
            return path or None
    return None


def extract_created_path(output: str) -> str | None:
    """Pull the file path out of a file-producing tool's result string."""
    return _match_markers(output, _CREATED_MARKERS)


def _latest_for_markers(
    executed: list[ExecutedTool], markers: tuple[re.Pattern[str], ...]
) -> str | None:
    for record in reversed(executed):
        out = record.get("output", "")
        if out.startswith("[failed]"):
            continue
        path = _match_markers(out, markers)
        if path:
            return path
    return None


def latest_created_artifact(executed: list[ExecutedTool]) -> str | None:
    """Most recent deliverable path this run produced.

    Prefers dedicated document artifacts (pdf/xlsx/doc); falls back to the most
    recent generic file write so any file type can still be delivered.
    """
    return _latest_for_markers(executed, _ARTIFACT_MARKERS) or _latest_for_markers(
        executed, _WRITE_MARKERS
    )


def whatsapp_delivery_succeeded(executed: list[ExecutedTool]) -> bool:
    for record in executed:
        if record.get("name") == "s3_send_whatsapp_document":
            if record.get("output", "").startswith("Sent"):
                return True
    return False


async def verify_and_complete_outcomes(
    *,
    prompt: str,
    executed: list[ExecutedTool],
    tool_executors: dict[str, Agents3Executor],
    log: Callable[..., None] | None = None,
) -> tuple[list[str], str]:
    """Check required outcomes against runtime state; finish any left unmet.

    Returns ``(extra_tool_names, summary)``. General across artifact types: it
    keys off *what was actually produced*, not a fixed step sequence.
    """
    extra: list[str] = []
    parts: list[str] = []

    artifact = latest_created_artifact(executed)

    # Outcome: a document artifact was requested but the model produced none.
    # We only rescue this when we have material to put in it (a source file we
    # can read) — we never fabricate content here.
    if wants_pdf_output(prompt) and artifact is None and "s3_create_pdf" in tool_executors:
        source = resolve_source_path(prompt)
        if source and source.is_file():
            body = source.read_text(encoding="utf-8", errors="replace")
            title = source.stem.replace("_", " ").replace("-", " ").strip() or "Document"
            if log:
                log("outcome_complete", outcome="artifact", kind="pdf", title=title)
            create_out = await tool_executors["s3_create_pdf"](
                json.dumps({"title": title, "content": body})
            )
            extra.append("s3_create_pdf")
            parts.append(create_out)
            if create_out.startswith("[failed]"):
                return extra, create_out
            artifact = extract_created_path(create_out)
        elif log:
            log("outcome_unmet", outcome="artifact", reason="no_source_to_build_from")

    # Outcome: delivery requested but not done — send whatever artifact exists.
    if wants_whatsapp_delivery(prompt) and not whatsapp_delivery_succeeded(executed):
        send_fn = tool_executors.get("s3_send_whatsapp_document")
        if artifact and send_fn:
            name = Path(artifact).name
            if log:
                log("outcome_complete", outcome="whatsapp_delivery", path=artifact[:120])
            send_out = await send_fn(
                json.dumps({"file_path": artifact, "file_name": name})
            )
            extra.append("s3_send_whatsapp_document")
            parts.append(send_out)
        elif log:
            log(
                "outcome_unmet",
                outcome="whatsapp_delivery",
                reason="no_artifact" if not artifact else "no_send_tool",
            )

    if not extra:
        return [], ""

    summary = "\n".join(p for p in parts if p.strip())
    if summary and not summary.startswith("[failed]"):
        summary = "Completed remaining requested steps automatically:\n" + summary
    return extra, summary
