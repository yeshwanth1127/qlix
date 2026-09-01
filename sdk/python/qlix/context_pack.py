"""Context Pack assembly shared by cloud and hybrid runners."""

from __future__ import annotations

import json
from typing import Any


CONTEXT_PACK_CONTRACT_VERSION = "qlix.context-pack.v1"


def estimate_tokens(text: str) -> int:
    return max(0, (len(text) + 3) // 4)


def pack_has_component(pack: Any, component: str) -> bool:
    if not isinstance(pack, dict):
        return False
    for item in pack.get("inline") or []:
        if isinstance(item, dict) and item.get("component") == component:
            return True
    for item in pack.get("references") or []:
        if isinstance(item, dict) and item.get("component") == component:
            return True
    return False


def pack_owns_brain(pack: Any) -> bool:
    """True when the Resolver already decided Brain for this dispatch."""
    if pack_has_component(pack, "brain") or pack_has_component(pack, "brain_summary"):
        return True
    if not isinstance(pack, dict):
        return False
    for item in pack.get("omitted") or []:
        if not isinstance(item, dict) or item.get("component") != "brain":
            continue
        reason = str(item.get("reason") or "")
        if reason.startswith("owned_"):
            return True
    return False


def should_prepend_brain(use_brain: bool, pack: Any) -> bool:
    """Legacy runners fetch Brain only when the pack did not already own it."""
    return bool(use_brain) and not pack_owns_brain(pack)


def pack_has_references(pack: Any) -> bool:
    return isinstance(pack, dict) and isinstance(pack.get("references"), list) and len(pack["references"]) > 0


def pack_allows_context_search(pack: Any, use_brain: bool = False) -> bool:
    return bool(use_brain) or pack_has_references(pack)


def assemble_run_prompt(
    prompt: str,
    pack: Any,
    memory_block: Any,
) -> tuple[str, dict[str, int]]:
    """Build the user-visible prompt and a component token map.

    New runners prefer a Context Pack. Legacy runners keep concatenating
    ``memoryBlock`` onto the raw task when no pack is present.
    """
    components: dict[str, int] = {}
    if isinstance(pack, dict) and pack.get("contractVersion") == CONTEXT_PACK_CONTRACT_VERSION:
        parts: list[str] = []
        for item in pack.get("inline") or []:
            if not isinstance(item, dict):
                continue
            component = str(item.get("component") or "unknown")
            text = item.get("text")
            if not isinstance(text, str) or not text.strip():
                data = item.get("data")
                text = json.dumps(data, ensure_ascii=False) if data is not None else ""
            if not text.strip():
                continue
            parts.append(text.strip())
            components[component] = int(item.get("tokens") or estimate_tokens(text))
        references = pack.get("references") or []
        if isinstance(references, list) and references:
            lines = ["Prior context (references):"]
            for ref in references:
                if not isinstance(ref, dict):
                    continue
                handle = str(ref.get("ref") or "").strip()
                summary = str(ref.get("summary") or "").strip()
                if handle:
                    lines.append(f"- {handle} — {summary}" if summary else f"- {handle}")
            index = "\n".join(lines)
            parts.append(index)
            components["references"] = estimate_tokens(index)
        if parts:
            if "task" not in components and prompt.strip():
                parts.append(prompt.strip())
                components["task"] = estimate_tokens(prompt)
            return "\n\n---\n\n".join(parts), components

    assembled = prompt
    if isinstance(memory_block, str) and memory_block.strip():
        assembled = f"{memory_block.strip()}\n\n---\n\n{prompt}"
        components["memory"] = estimate_tokens(memory_block)
    components["task"] = components.get("task", estimate_tokens(prompt))
    return assembled, components
