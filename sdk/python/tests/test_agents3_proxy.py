"""Tests for Agent-S3 Qlix proxy engine params."""

from __future__ import annotations

import os

from qlix.agents3_proxy import (
    Agents3RunContext,
    build_qlix_s3_engine_params,
    model_for_gui_agents,
    resolve_s3_engine_params,
)


def test_model_for_gui_agents_strips_openrouter_prefix():
    assert model_for_gui_agents("openrouter/openai/gpt-4o-mini") == "openai/gpt-4o-mini"
    assert model_for_gui_agents("gpt-4o-mini") == "gpt-4o-mini"


def test_build_qlix_s3_engine_params_url_and_auth():
    params = build_qlix_s3_engine_params(
        backend_url="http://localhost:4000/",
        agent_id="agent-abc",
        runner_token="secret-token",
        model="openrouter/openai/gpt-4o",
    )
    assert params["engine_type"] == "openai"
    assert params["model"] == "openai/gpt-4o"
    assert params["api_key"] == "secret-token"
    assert params["base_url"] == "http://localhost:4000/api/v1/agents/agent-abc/inference/v1"


def test_resolve_s3_engine_params_uses_qlix_proxy_when_proxy_mode():
    os.environ.pop("QLIX_S3_USE_LOCAL_KEYS", None)
    gen, ground = resolve_s3_engine_params(
        "proxy",
        backend_url="http://localhost:4000",
        agent_id="a1",
        runner_token="tok",
        model="openrouter/openai/gpt-4o-mini",
    )
    assert "base_url" in gen
    assert gen["api_key"] == "tok"
    assert "OPENAI_API_KEY" not in gen
    assert ground["base_url"] == gen["base_url"]


def test_resolve_s3_engine_params_local_when_flag_set():
    os.environ["QLIX_S3_USE_LOCAL_KEYS"] = "1"
    try:
        gen, _ = resolve_s3_engine_params(
            "proxy",
            backend_url="http://localhost:4000",
            agent_id="a1",
            runner_token="tok",
            model="openrouter/openai/gpt-4o-mini",
        )
        assert "base_url" not in gen
    finally:
        os.environ.pop("QLIX_S3_USE_LOCAL_KEYS", None)


def test_agents3_run_context_fields():
    ctx = Agents3RunContext(
        agent_id="a",
        runner_token="t",
        model="openrouter/openai/gpt-4o",
        run_id="run-1",
        log_emit=None,
    )
    assert ctx.run_id == "run-1"
    assert ctx.log_emit is None
