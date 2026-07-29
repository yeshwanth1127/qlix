"""Shared Markdown -> PDF renderer (reportlab).

Used by the hybrid file tool (``agents3_runtime._create_pdf_file``) and the cloud
report tool (``cloud_document_runtime.create_report_pdf``) so both render reports
identically. Supports a lightweight Markdown subset: ``#``/``##``/``###``
headings, ``**bold**``, ``*italic*``, ``-``/``*`` bullet lists, and ``---``
horizontal rules.

The visual style is a clean, standard report look: a sans-serif family
(Helvetica), bold accent-coloured headings, and thin rules under the title and
section headings. The accent matches the product brand (``#2563eb``).
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

# Brand palette (kept in sync with the frontend --accent / --text-primary).
_ACCENT = "#2563eb"       # headings + title rule
_INK = "#111827"          # title text
_BODY = "#1f2937"         # body copy
_MUTED = "#6b7280"        # H3 / secondary text
_RULE = "#e5e7eb"         # light section rules

_BODY_FONT = "Helvetica"
_BOLD_FONT = "Helvetica-Bold"


def _build_styles() -> dict[str, Any]:
    from reportlab.lib.colors import HexColor
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import ParagraphStyle

    return {
        "Title": ParagraphStyle(
            "QlixTitle",
            fontName=_BOLD_FONT,
            fontSize=22,
            leading=27,
            textColor=HexColor(_INK),
            spaceAfter=4,
            alignment=TA_LEFT,
        ),
        "Heading1": ParagraphStyle(
            "QlixH1",
            fontName=_BOLD_FONT,
            fontSize=16,
            leading=20,
            textColor=HexColor(_ACCENT),
            spaceBefore=16,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "Heading2": ParagraphStyle(
            "QlixH2",
            fontName=_BOLD_FONT,
            fontSize=13,
            leading=17,
            textColor=HexColor(_ACCENT),
            spaceBefore=12,
            spaceAfter=3,
            keepWithNext=True,
        ),
        "Heading3": ParagraphStyle(
            "QlixH3",
            fontName=_BOLD_FONT,
            fontSize=11,
            leading=15,
            textColor=HexColor(_MUTED),
            spaceBefore=10,
            spaceAfter=2,
            keepWithNext=True,
        ),
        "BodyText": ParagraphStyle(
            "QlixBody",
            fontName=_BODY_FONT,
            fontSize=10.5,
            leading=15,
            textColor=HexColor(_BODY),
            spaceAfter=6,
        ),
        "Bullet": ParagraphStyle(
            "QlixBullet",
            fontName=_BODY_FONT,
            fontSize=10.5,
            leading=15,
            textColor=HexColor(_BODY),
        ),
    }


def render_markdown_pdf(*, title: str, content: str, out: Path) -> tuple[bool, str]:
    """Render ``title`` + Markdown ``content`` to a PDF at ``out``.

    Returns ``(ok, message)`` where ``message`` is a success string that includes
    the resolved path (``"Created PDF: <path>"``) or an error description.
    """
    if not (content.strip() or title.strip()):
        return False, "content is required to create a PDF"

    try:
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            HRFlowable,
            ListFlowable,
            ListItem,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
        )
    except ImportError:
        return (
            False,
            "reportlab is not installed. Install the hybrid extras: "
            "pip install 'qlix[hybrid]' (or pip install reportlab).",
        )

    styles = _build_styles()

    def _md_inline(text: str) -> str:
        esc = html.escape(text)
        esc = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", esc)
        esc = re.sub(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*", r"<i>\1</i>", esc)
        return esc

    def _is_bullet(line: str) -> bool:
        return line.lstrip().startswith(("- ", "* "))

    def _is_rule(block: str) -> bool:
        return bool(re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", block.strip()))

    def _flush_bullets(buf: list[str], story: list[Any]) -> None:
        if not buf:
            return
        items = [
            ListItem(
                Paragraph(_md_inline(ln.lstrip()[2:]), styles["Bullet"]),
                bulletColor=HexColor(_ACCENT),
            )
            for ln in buf
        ]
        story.append(ListFlowable(items, bulletType="bullet", leftIndent=14))
        story.append(Spacer(1, 6))
        buf.clear()

    story: list[Any] = []
    if title.strip():
        story.append(Paragraph(_md_inline(title.strip()), styles["Title"]))
        story.append(HRFlowable(width="100%", thickness=2, color=HexColor(_ACCENT), spaceBefore=2, spaceAfter=12))

    blocks = re.split(r"\n\s*\n", content.replace("\r\n", "\n"))
    for block in blocks:
        block = block.strip("\n")
        if not block.strip():
            continue

        if _is_rule(block):
            story.append(HRFlowable(width="100%", thickness=0.75, color=HexColor(_RULE), spaceBefore=8, spaceAfter=8))
            continue

        if block.startswith("### "):
            story.append(Paragraph(_md_inline(block[4:]), styles["Heading3"]))
            continue
        if block.startswith("## "):
            story.append(Paragraph(_md_inline(block[3:]), styles["Heading2"]))
            story.append(HRFlowable(width="100%", thickness=0.75, color=HexColor(_RULE), spaceBefore=2, spaceAfter=6))
            continue
        if block.startswith("# "):
            story.append(Paragraph(_md_inline(block[2:]), styles["Heading1"]))
            story.append(HRFlowable(width="100%", thickness=1, color=HexColor(_ACCENT), spaceBefore=2, spaceAfter=6))
            continue

        # Body block: group consecutive bullet lines into lists, everything else
        # into paragraphs, so mixed blocks render correctly.
        bullet_buf: list[str] = []
        para_buf: list[str] = []
        for ln in block.split("\n"):
            if _is_bullet(ln):
                if para_buf:
                    story.append(
                        Paragraph("<br/>".join(_md_inline(p) for p in para_buf), styles["BodyText"])
                    )
                    para_buf = []
                bullet_buf.append(ln)
            else:
                _flush_bullets(bullet_buf, story)
                para_buf.append(ln)
        _flush_bullets(bullet_buf, story)
        if para_buf:
            story.append(
                Paragraph("<br/>".join(_md_inline(p) for p in para_buf), styles["BodyText"])
            )

    try:
        doc = SimpleDocTemplate(
            str(out),
            pagesize=LETTER,
            leftMargin=0.9 * inch,
            rightMargin=0.9 * inch,
            topMargin=0.9 * inch,
            bottomMargin=0.9 * inch,
            title=title.strip() or out.stem,
        )
        doc.build(story)
    except Exception as exc:
        return False, f"PDF generation error: {exc}"

    return True, f"Created PDF: {out.resolve()}"
