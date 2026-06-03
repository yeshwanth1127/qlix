from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .http_client import QlixHttpClient


@dataclass(frozen=True)
class BackendInferenceResult:
    content: str
    finish_reason: str | None
    usage: dict[str, Any]
    provider: str | None
    tool_calls: list[dict[str, Any]] | None


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
    response = await http.post_json(
        f"/api/v1/agents/{agent_id}/inference/chat",
        body,
        headers=headers,
    )
    raw_calls = response.get("tool_calls")
    tool_calls: list[dict[str, Any]] | None = None
    if isinstance(raw_calls, list) and len(raw_calls) > 0:
        tool_calls = [c for c in raw_calls if isinstance(c, dict)]
    return BackendInferenceResult(
        content=str(response.get("content", "") or ""),
        finish_reason=response.get("finish_reason") if response.get("finish_reason") is not None else None,
        usage=response.get("usage", {}) if isinstance(response.get("usage"), dict) else {},
        provider=str(response.get("provider")) if response.get("provider") is not None else None,
        tool_calls=tool_calls or None,
    )
