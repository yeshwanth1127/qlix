from __future__ import annotations

import json
import os
import sys
from typing import Any


def _route_log(mode: str, reason: str, prompt: str, skills: list[Any]) -> None:
    if os.environ.get("QLIX_ROUTE_LOGS", "true").strip().lower() in {"0", "false", "off", "no"}:
        return
    payload = {
        "mode": mode,
        "reason": reason,
        "prompt_preview": (prompt or "")[:180],
        "skills_count": len(skills) if isinstance(skills, list) else 0,
    }
    print(f"[cloud_route] {json.dumps(payload, ensure_ascii=False)}", file=sys.stderr, flush=True)


def route_mode(prompt: str, skills: list[Any]) -> str:
    text = (prompt or "").lower()
    task_markers = [
        "plan",
        "steps",
        "analyze",
        "research",
        "execute",
        "build",
        "fix",
        "compare",
        "summarize",
        "send",
        "create",
    ]
    multi_step_markers = [" then ", " and ", " after ", " while ", " finally "]
    if len((prompt or "").strip()) > 180:
        _route_log("orchestrator", "long_prompt", prompt, skills)
        return "orchestrator"
    for marker in task_markers:
        if marker in text:
            _route_log("orchestrator", f"task_marker:{marker}", prompt, skills)
            return "orchestrator"
    for marker in multi_step_markers:
        if marker in text:
            _route_log("orchestrator", f"multi_step_marker:{marker.strip()}", prompt, skills)
            return "orchestrator"
    if isinstance(skills, list) and len(skills) > 0:
        _route_log("orchestrator", "skills_selected", prompt, skills)
        return "orchestrator"
    _route_log("direct", "default_direct", prompt, skills)
    return "direct"

