"""Tests for research vs web tool group routing."""

from __future__ import annotations

from qlix.identity import AgentIdentity
from qlix.tool_router import ToolRouter, classify_groups


def _id(**kwargs: object) -> AgentIdentity:
    base = {
        "did": "did:t:1",
        "agent_id": "a1",
        "private_key_hex": "0" * 64,
        "public_key_hex": "1" * 64,
        "permission_scopes": ("web.research", "web.read", "web.click"),
        "jit_scopes": (),
        "always_scopes": (),
        "backend_url": "http://localhost",
        "llm_mode": "proxy",
        "raw": {},
    }
    base.update(kwargs)
    return AgentIdentity(
        did=str(base["did"]),
        agent_id=str(base["agent_id"]),
        private_key_hex=str(base["private_key_hex"]),
        public_key_hex=str(base["public_key_hex"]),
        permission_scopes=tuple(base["permission_scopes"]),  # type: ignore[arg-type]
        jit_scopes=tuple(base["jit_scopes"]),  # type: ignore[arg-type]
        always_scopes=tuple(base["always_scopes"]),  # type: ignore[arg-type]
        backend_url=str(base["backend_url"]),
        llm_mode=str(base["llm_mode"]),
        raw=dict(base["raw"]),  # type: ignore[arg-type]
    )


def test_research_prompt_prefers_research_over_browser() -> None:
    """A research prompt must steer to research_*, not open the browser first.

    This used to be asserted as "web not in groups", i.e. the browser tools were
    physically withheld. Two things changed since: an agent granted web.read keeps the
    browser as a fallback for blocked platform APIs, and group classification no longer
    decides which tools are offered at all (the tool array is scope-derived so it stays
    cacheable). The steer now lives in the run-context block, so that is what to assert.
    """
    ident = _id()
    router = ToolRouter(ident, runner_runtime="cloud")
    plan = router.plan_run("research LLM frameworks and compare options", context="")
    assert "research" in plan.groups
    preference = router.tool_preference(plan)
    assert "research_*" in preference
    assert "browser" in preference.lower()


def test_login_prompt_loads_web_not_research() -> None:
    ident = _id()
    groups = classify_groups(
        "login to dashboard and fill the registration form",
        ident,
        runner_runtime="cloud",
    )
    assert "web" in groups
    assert "research" not in groups


def test_twitter_research_without_interaction() -> None:
    ident = _id()
    groups = classify_groups(
        "research Twitter sentiment for product X",
        ident,
        runner_runtime="cloud",
    )
    assert "research" in groups
    # No interaction verb (login/fill/submit), so the run must not be steered at the
    # browser even though web.read keeps it available as a fallback.
    router = ToolRouter(ident, runner_runtime="cloud")
    plan = router.plan_run("research Twitter sentiment for product X", context="")
    assert "research_*" in router.tool_preference(plan)


def test_spreadsheet_prompt_loads_research_group() -> None:
    ident = _id(permission_scopes=("web.research",))
    groups = classify_groups(
        "create an excel spreadsheet with monthly sales data",
        ident,
        runner_runtime="cloud",
    )
    assert "research" in groups


def test_delegated_web_research_scope_only() -> None:
    ident = _id(permission_scopes=("web.research",))
    groups = classify_groups(
        "read https://example.com/article about AI",
        ident,
        runner_runtime="cloud",
        skill_filter=["web.research"],
    )
    assert "research" in groups
    assert "web" not in groups


def test_interaction_keeps_web_with_platform_keywords() -> None:
    ident = _id()
    groups = classify_groups(
        "login to bilibili and fill the comment form",
        ident,
        runner_runtime="cloud",
    )
    assert "web" in groups


def test_lead_website_email_enrichment_loads_web() -> None:
    ident = _id(
        permission_scopes=(
            "mcp.qlix-leads.list_leads",
            "mcp.qlix-leads.update_lead_email",
            "web.read",
            "web.click",
        )
    )
    groups = classify_groups(
        "search their website for emails",
        ident,
        runner_runtime="cloud",
    )
    assert "web" in groups
    assert "research" not in groups


def test_lead_enrichment_without_web_read_omits_web_group() -> None:
    ident = _id(permission_scopes=("mcp.qlix-leads.list_leads", "mcp.qlix-leads.gmb_search_leads"))
    groups = classify_groups(
        "search their website for emails",
        ident,
        runner_runtime="cloud",
    )
    assert "web" not in groups


def test_lead_generation_intent_detected() -> None:
    from qlix.tool_router import is_lead_generation_intent

    assert is_lead_generation_intent(
        "generate leads for me. i need cafes around bangalore. generate 5"
    )
    assert not is_lead_generation_intent("search their website for emails")


def test_learn_and_understand_route_to_research() -> None:
    ident = _id()
    router = ToolRouter(ident, runner_runtime="cloud")
    for prompt in (
        "learn about quantum computing trends",
        "help me understand how RAG works",
        "do a deep research on competitor pricing",
        "read about the latest AI safety papers",
    ):
        groups = classify_groups(prompt, ident, runner_runtime="cloud")
        assert "research" in groups, prompt
        assert "research_*" in router.tool_preference(router.plan_run(prompt, context="")), prompt


def test_tool_array_does_not_change_with_research_wording() -> None:
    """Scope ceiling is unchanged by phrasing — the prerequisite for prefix caching."""
    import hashlib
    import json

    router = ToolRouter(_id(), runner_runtime="cloud")
    hashes = set()
    for prompt in (
        "research LLM frameworks and compare options",
        "login to dashboard and fill the registration form",
        "hello",
    ):
        tools = router.build_tool_definitions(router.plan_run(prompt, context=""))
        hashes.add(hashlib.md5(json.dumps(tools, sort_keys=True).encode()).hexdigest())
    assert len(hashes) == 1
