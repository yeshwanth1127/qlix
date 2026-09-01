from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .http_client import HttpError, QlixHttpClient


@dataclass(frozen=True)
class BackendInferenceResult:
    content: str
    finish_reason: str | None
    usage: dict[str, Any]
    provider: str | None
    tool_calls: list[dict[str, Any]] | None
    """Concrete model the backend router actually used (Auto resolves to one of these)."""
    routed_model: str | None = None
    cascade_phase: str | None = None
    routing_reason: str | None = None


async def backend_proxy_chat_completion(
    http: QlixHttpClient,
    *,
    agent_id: str,
    headers: dict[str, str],
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.2,
    max_tokens: int = 1024,
    run_id: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict[str, Any] | None = None,
    tools_hash: str | None = None,
    pinned_model: str | None = None,
    reasoning_effort: str | None = None,
    cascade_phase: str | None = None,
    cascade_force_handoff: bool = False,
    cascade_escalate_reason: str | None = None,
    cascade_scout_failures: int | None = None,
    cascade_synthesis_round: bool = False,
) -> BackendInferenceResult:
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "metadata": {"runId": run_id, "agentId": agent_id},
    }
    if tools:
        body["tools"] = tools
    if tools_hash:
        body["tools_hash"] = tools_hash
    if tool_choice is not None:
        body["tool_choice"] = tool_choice
    if pinned_model:
        body["pinned_model"] = pinned_model
    if reasoning_effort:
        body["reasoning_effort"] = reasoning_effort
    if cascade_phase:
        body["cascade_phase"] = cascade_phase
    if cascade_force_handoff:
        body["cascade_force_handoff"] = True
    if cascade_escalate_reason:
        body["cascade_escalate_reason"] = cascade_escalate_reason
    if cascade_scout_failures is not None:
        body["cascade_scout_failures"] = int(cascade_scout_failures)
    if cascade_synthesis_round:
        body["cascade_synthesis_round"] = True
    body["reasoning_purpose"] = "agent"
    response = await http.post_json(
        f"/api/v1/agents/{agent_id}/inference/chat",
        body,
        headers=headers,
    )
    raw_calls = response.get("tool_calls")
    tool_calls: list[dict[str, Any]] | None = None
    if isinstance(raw_calls, list) and len(raw_calls) > 0:
        tool_calls = [c for c in raw_calls if isinstance(c, dict)]
    routed = response.get("routed_model")
    phase = response.get("cascade_phase")
    reason = response.get("routing_reason")
    return BackendInferenceResult(
        content=str(response.get("content", "") or ""),
        finish_reason=response.get("finish_reason") if response.get("finish_reason") is not None else None,
        usage=response.get("usage", {}) if isinstance(response.get("usage"), dict) else {},
        provider=str(response.get("provider")) if response.get("provider") is not None else None,
        tool_calls=tool_calls or None,
        routed_model=str(routed) if isinstance(routed, str) and routed.strip() else None,
        cascade_phase=str(phase) if isinstance(phase, str) and phase.strip() else None,
        routing_reason=str(reason) if isinstance(reason, str) and reason.strip() else None,
    )


def classify_inference_handoff(err: BaseException) -> tuple[bool, str, str]:
    """Return (should_handoff, mode, reason) for cascade mid-run failover."""
    status = 0
    code = ""
    msg = str(err).lower()
    if isinstance(err, HttpError):
        status = int(getattr(err, "status_code", 0) or 0)
        body = getattr(err, "body", None)
        if isinstance(body, dict):
            err_obj = body.get("error")
            if isinstance(err_obj, dict):
                code = str(err_obj.get("code") or "").lower()
                msg = f"{msg} {err_obj.get('message') or ''}".lower()
    if status == 429 or "rate_limited" in code or "rate limit" in msg:
        return True, "same_history", "rate_limited"
    if "quota_exhausted" in code or "quota" in msg:
        return True, "same_history", "quota_exhausted"
    if "context_overflow" in code or ("context" in msg and status == 400):
        return True, "brief", "context_overflow"
    if status in {502, 503, 504}:
        return True, "same_history", "free_unhealthy"
    return False, "none", "forced"


def build_decision_brief_from_messages(
    messages: list[dict[str, Any]],
    *,
    max_chars: int = 6000,
) -> str:
    """Deterministic handoff brief so paid models skip full tool dumps."""
    goal = ""
    facts: list[str] = []
    artifacts: list[str] = []
    for m in messages:
        role = str(m.get("role") or "")
        content = m.get("content")
        text = content if isinstance(content, str) else ""
        if not text:
            continue
        if role == "user" and not goal:
            marker = "Task:\n"
            idx = text.find(marker)
            goal = (text[idx + len(marker) :] if idx >= 0 else text).strip()[:1500]
        if role == "tool":
            clip = " ".join(text.split()).strip()[:280]
            if clip and not clip.startswith("[cleared:"):
                facts.append(clip)
            for token in text.split():
                if token.startswith("http://") or token.startswith("https://"):
                    artifacts.append(token.rstrip(").,]\"'"))
                    if len(artifacts) >= 30:
                        break
    lines = [
        "# Decision Brief (cascade handoff)",
        "",
        "## Goal",
        goal or "(not provided)",
    ]
    if facts:
        lines.extend(["", "## Facts gathered", *[f"- {f}" for f in facts[:40]]])
    if artifacts:
        lines.extend(["", "## Artifacts / refs", *[f"- {a}" for a in artifacts[:30]]])
    lines.extend(
        [
            "",
            "## Instructions",
            "Continue from this checkpoint. Do not redo completed tool work.",
            "Call tools only if a fact or artifact must be re-fetched.",
            "Return the final answer when enough information is present.",
        ]
    )
    out = "\n".join(lines)
    if len(out) > max_chars:
        out = out[: max_chars - 20] + "\n…[truncated]"
    return out
