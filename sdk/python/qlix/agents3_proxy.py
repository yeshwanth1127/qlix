"""Agent-S3 engine params routed through Qlix OpenRouter proxy (no local API keys)."""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

Agents3LogEmit = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass
class Agents3RunContext:
    agent_id: str
    runner_token: str
    model: str
    run_id: str | None = None
    log_emit: Agents3LogEmit | None = field(default=None, compare=False, repr=False)


def model_for_gui_agents(model: str) -> str:
    """Strip Qlix canonical prefix; gui-agents forwards model in the request body."""
    t = (model or "").strip()
    if t.lower().startswith("openrouter/"):
        return t[len("openrouter/") :]
    return t


def build_qlix_s3_engine_params(
    *,
    backend_url: str,
    agent_id: str,
    runner_token: str,
    model: str,
    temperature: float = 0.2,
) -> dict[str, Any]:
    """OpenAI-compatible engine pointed at Qlix inference shim (Bearer = runner token)."""
    base = backend_url.rstrip("/")
    return {
        "engine_type": "openai",
        "model": model_for_gui_agents(model),
        "base_url": f"{base}/api/v1/agents/{agent_id}/inference/v1",
        "api_key": runner_token,
        "temperature": temperature,
    }


def resolve_s3_engine_params(
    identity_llm_mode: str,
    *,
    backend_url: str,
    agent_id: str,
    runner_token: str,
    model: str,
    grounding_model: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Return (generation_params, grounding_params) for Agent-S3.
    Uses Qlix proxy when llm_mode is proxy and a runner token is present.
    """
    use_local = os.environ.get("QLIX_S3_USE_LOCAL_KEYS", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    if (
        not use_local
        and identity_llm_mode == "proxy"
        and runner_token.strip()
        and backend_url.strip()
        and agent_id.strip()
    ):
        gen = build_qlix_s3_engine_params(
            backend_url=backend_url,
            agent_id=agent_id,
            runner_token=runner_token,
            model=model,
        )
        ground_model = (grounding_model or model).strip() or model
        ground = build_qlix_s3_engine_params(
            backend_url=backend_url,
            agent_id=agent_id,
            runner_token=runner_token,
            model=ground_model,
        )
        return gen, ground

    engine_type = os.environ.get("QLIX_S3_ENGINE_TYPE", "openai")
    gen_model = os.environ.get("QLIX_S3_MODEL") or os.environ.get(
        "QLIX_PROXY_MODEL", "gpt-4o-mini"
    )
    gen: dict[str, Any] = {
        "engine_type": engine_type,
        "model": model_for_gui_agents(gen_model),
    }
    ground_model = os.environ.get("QLIX_S3_GROUNDING_MODEL") or gen_model
    ground: dict[str, Any] = {
        "engine_type": engine_type,
        "model": model_for_gui_agents(ground_model),
    }
    return gen, ground
