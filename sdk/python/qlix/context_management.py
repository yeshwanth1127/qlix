"""Deterministic context inventory, artifact spillover, and structured compaction."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from importlib.resources import files
from typing import Any, Iterable


_URL_RE = re.compile(r"https?://[^\s<>\"'\)\]]+", re.I)
_PATH_RE = re.compile(r"(?:[A-Za-z]:\\[^\n\r]+|/(?:[^\s/]+/)+[^\s]+)")
_ID_RE = re.compile(
    r"\b(?:artifact|file|document|spreadsheet|presentation|form|page|run|task|action)"
    r"(?:Id|_id)?\s*[:=]\s*[\"']?([A-Za-z0-9_.:/-]{6,})",
    re.I,
)


@dataclass(frozen=True, slots=True)
class ContextArtifact:
    artifact_id: str
    sha256: str
    source_kind: str
    content: str
    char_count: int
    references: tuple[str, ...] = ()

    def reference_text(self) -> str:
        refs = f"; refs={', '.join(self.references[:8])}" if self.references else ""
        return (
            f"[context artifact {self.artifact_id}; {self.char_count} chars; "
            f"sha256={self.sha256[:16]}{refs}]"
        )


@dataclass(slots=True)
class StructuredContext:
    objectives: list[str] = field(default_factory=list)
    requirements: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    approvals: list[str] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)
    unfinished_work: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    source_artifact_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_text(self, *, max_chars: int = 6000) -> str:
        sections = ["[Structured earlier context — preserve these facts]"]
        labels = (
            ("Objectives", self.objectives),
            ("Requirements and constraints", self.requirements),
            ("Decisions", self.decisions),
            ("Approvals", self.approvals),
            ("Artifacts and durable references", self.artifacts),
            ("Unfinished work", self.unfinished_work),
            ("Other relevant context", self.notes),
            ("Full-history artifacts", self.source_artifact_ids),
        )
        for label, values in labels:
            if values:
                sections.append(f"{label}:\n" + "\n".join(f"- {v}" for v in values))
        text = "\n".join(sections)
        return text if len(text) <= max_chars else text[: max_chars - 1].rstrip() + "…"


def load_context_source_catalog() -> dict[str, Any]:
    resource = files("qlix").joinpath("data/context_source_catalog.json")
    return json.loads(resource.read_text(encoding="utf-8"))


def extract_references(text: str) -> tuple[str, ...]:
    refs = list(_URL_RE.findall(text)) + list(_PATH_RE.findall(text))
    refs.extend(match.group(1) for match in _ID_RE.finditer(text))
    return tuple(dict.fromkeys(ref.strip().rstrip(".,;") for ref in refs if ref.strip()))


def make_context_artifact(content: str, *, source_kind: str) -> ContextArtifact:
    digest = hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()
    return ContextArtifact(
        artifact_id=f"ctx-{digest[:20]}",
        sha256=digest,
        source_kind=source_kind,
        content=content,
        char_count=len(content),
        references=extract_references(content),
    )


def _append_unique(target: list[str], value: str, *, limit: int = 40) -> None:
    clean = " ".join(value.split()).strip(" -")
    if clean and clean not in target and len(target) < limit:
        target.append(clean[:800])


def build_structured_context(
    messages: Iterable[Any],
    *,
    source_artifact_ids: Iterable[str] = (),
) -> StructuredContext:
    """Extract load-bearing context without an LLM or hidden heuristics."""
    result = StructuredContext(source_artifact_ids=list(dict.fromkeys(source_artifact_ids)))
    for raw in messages:
        if isinstance(raw, dict):
            role = str(raw.get("role", ""))
            content = str(raw.get("content") or "")
        else:
            role_value = getattr(raw, "role", "")
            role = str(getattr(role_value, "value", role_value))
            content = str(getattr(raw, "content", "") or "")
        if not content.strip():
            continue
        refs = extract_references(content)
        for ref in refs:
            _append_unique(result.artifacts, ref)

        chunks = [c.strip() for c in re.split(r"(?<=[.!?])\s+|\n+", content) if c.strip()]
        for chunk in chunks:
            low = chunk.lower()
            if role == "user":
                _append_unique(result.objectives, chunk)
            if any(k in low for k in ("must", "need to", "do not", "don't", "without", "keep ", "preserve", "require")):
                _append_unique(result.requirements, chunk)
            elif any(k in low for k in ("approved", "approve", "permission granted", "allow this")):
                _append_unique(result.approvals, chunk)
            elif any(k in low for k in ("decided", "decision:", "chosen", "we will", "use ", "selected")):
                _append_unique(result.decisions, chunk)
            elif any(k in low for k in ("todo", "pending", "remaining", "unfinished", "next step", "blocker", "continue")):
                _append_unique(result.unfinished_work, chunk)
            elif role in ("assistant", "system"):
                _append_unique(result.notes, chunk)
    return result


def serialize_messages(messages: Iterable[Any]) -> str:
    rows: list[dict[str, Any]] = []
    for message in messages:
        if isinstance(message, dict):
            rows.append(message)
            continue
        role_value = getattr(message, "role", "")
        rows.append(
            {
                "role": str(getattr(role_value, "value", role_value)),
                "content": str(getattr(message, "content", "") or ""),
                "channel": str(getattr(message, "channel", "") or ""),
                "timestamp": float(getattr(message, "timestamp", 0.0) or 0.0),
                "metadata": getattr(message, "metadata", {}) or {},
            }
        )
    return json.dumps(rows, ensure_ascii=False, sort_keys=True, default=repr)


__all__ = [
    "ContextArtifact",
    "StructuredContext",
    "build_structured_context",
    "extract_references",
    "load_context_source_catalog",
    "make_context_artifact",
    "serialize_messages",
]
