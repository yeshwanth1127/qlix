from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from typing import Any

from .cloud_adk_loader import load_cloud_adk
from .http_client import QlixHttpClient
from .identity import AgentIdentity, load_identity
from .runner_common import (
    emit_inference_result_events,
    emit_event as _emit_event,
    get_adaptive_settle_time as _get_adaptive_settle_time,
    maybe_prepend_brain_context as _shared_maybe_prepend_brain_context,
)

# Orchestrator mode removed: using agent-browser tools only


def _log(stage: str, **kwargs: object) -> None:
    payload = {"stage": stage, **kwargs}
    print(f"[cloud_runner] {json.dumps(payload, ensure_ascii=False)}", file=sys.stderr, flush=True)


async def _maybe_prepend_brain_context(
    http: QlixHttpClient,
    *,
    agent_id: str,
    run_id: str,
    headers: dict[str, str],
    prompt: str,
    use_brain: bool,
    seq: int,
) -> tuple[str, int]:
    return await _shared_maybe_prepend_brain_context(
        http,
        agent_id=agent_id,
        run_id=run_id,
        headers=headers,
        prompt=prompt,
        use_brain=use_brain,
        seq=seq,
        log=_log,
    )


def _build_run_guidance(
    identity: AgentIdentity,
    *,
    groups: tuple[str, ...] | None,
    instruction: str,
    base_guidance: str,
) -> str:
    """TIER B guidance — intent-specific, so it must stay out of the cached prefix.

    `base_guidance` is what ToolRouter.plan_run already derived. Added here is the
    CRM-scope-aware advisory, which plan_run cannot produce because it does not
    inspect crm.* grants against the SDK wiring.
    """
    from .tool_router import (
        has_crm_scope,
        has_forms_scope,
        is_crm_mutation_intent,
        crm_jit_run_guidance,
        crm_no_invent_guidance,
        forms_reuse_guidance,
    )
    from .cloud_crm_runtime import crm_jit_needs_sdk

    parts: list[str] = []
    if has_crm_scope(identity) and crm_jit_needs_sdk(identity):
        # Only promote CRM writes when the user actually asked for a CRM mutation.
        # Having CRM tools available (comms group) must NOT nudge inventing create/update work.
        if is_crm_mutation_intent(instruction):
            parts.append(crm_jit_run_guidance())
        else:
            parts.append(crm_no_invent_guidance())
    if has_forms_scope(identity):
        parts.append(forms_reuse_guidance())
    # plan_run's guidance last so run-specific playbooks read after the advisories.
    if base_guidance.strip():
        parts.append(base_guidance.strip())
    # De-dup: plan_run and the checks above can derive the same playbook.
    seen: set[str] = set()
    unique = [p for p in parts if not (p in seen or seen.add(p))]
    return "\n\n".join(unique)


def _build_system_prompt(
    agent_description: str | None,
    identity: AgentIdentity,
) -> str:
    """TIER A — who the agent is and what its scopes allow. Invariant per agent.

    Everything here is a function of the agent alone (description + granted scopes),
    never of the current prompt or the clock. Together with the scope-derived tool
    array this forms the cached prompt prefix, so it is served from the provider's
    cache on every round of every run rather than re-billed each time.

    Anything per-run — the clock, intent guidance, retrieved brain/memory context, the
    task itself — belongs in the run-context block (see `build_run_context_block`),
    which is appended to the user message *after* this prefix.
    """
    from .runner_common import describe_capabilities

    identity_line = (agent_description or "").strip() or (
        "an autonomous AI agent running on the Qlix platform"
    )
    # Descriptions written by the AI builder usually already start with "You are ...";
    # prefixing again produced "You are You are a Slack assistant.".
    if re.match(r"^you\s+are\b", identity_line, re.IGNORECASE):
        identity_statement = identity_line.rstrip(".") + "."
    else:
        identity_statement = f"You are {identity_line.rstrip('.')}."
    granted = (
        set(identity.permission_scopes)
        | set(identity.always_scopes)
        | set(identity.jit_scopes)
    )
    parts = [
        identity_statement,
        describe_capabilities(granted),
        (
            "Reply directly to the user in plain language. Never include internal reasoning, "
            "thought traces, or meta-commentary about tools, scopes, or prior errors."
        ),
    ]
    return "\n\n".join(parts)


async def _run_backend_proxy_inference(
    http: QlixHttpClient,
    *,
    identity: AgentIdentity,
    agent_id: str,
    headers: dict[str, str],
    seq: int,
    run_id: str,
    model: str,
    enriched_prompt: str,
    selected_skills: list[str],
    agent_description: str | None = None,
    mcp_servers: Any = None,
    tool_profile: str = "full",
    askable_agents: list[dict[str, Any]] | None = None,
    reasoning_effort: str | None = None,
    conversation_id: str | None = None,
    team_run_id: str | None = None,
    team_id: str | None = None,
    context_components: dict[str, int] | None = None,
    has_context_refs: bool = False,
    enable_context_search: bool = False,
) -> tuple[int, str, int, int, list[str], dict[str, Any], list[dict[str, str]]]:
    """Multi-turn proxy inference with ToolRouter-selected browser/email/MCP tools."""
    import hashlib

    from .runner_common import (
        build_run_context_block,
        default_log,
        run_backend_proxy_inference,
    )
    from .tool_router import ToolRouter
    from .cloud_email_runtime import email_send_needs_jit
    from .cloud_crm_runtime import crm_jit_needs_sdk
    from .cloud_whatsapp_runtime import whatsapp_contact_send_needs_jit

    router = ToolRouter(identity, runner_runtime="cloud")
    instruction = enriched_prompt.split("\n\nSelected skills/tools:")[0].strip()
    # The agent's standing description is the trusted source of intent — a keyword-less
    # prompt ("go", a greeting) shouldn't force-load tools, but a browsing agent's
    # description should still steer routing to the right tool groups.
    plan = router.plan_run(
        instruction,
        skill_filter=selected_skills or None,
        context=agent_description or "",
    )
    _log("tool_router_plan", run_id=run_id, groups=list(plan.groups))

    tools = router.build_tool_definitions(
        plan,
        mcp_servers=mcp_servers,
        tool_profile=tool_profile,
        askable_agents=askable_agents,
        has_context_refs=has_context_refs,
        enable_context_search=enable_context_search,
    )
    if router.last_budget_report:
        _log("tool_budget", run_id=run_id, **router.last_budget_report)
    backend_url = os.environ.get("QLIX_BACKEND_URL", identity.backend_url).strip()
    runner_token = os.environ.get("QLIX_RUNNER_TOKEN", "").strip()
    # MCP, research, and JIT-gated email/CRM/WhatsApp contact tools need the SDK.
    needs_sdk = (
        bool(mcp_servers)
        or "research" in plan.groups
        or (
            "comms" in plan.groups
            and (
                email_send_needs_jit(identity)
                or crm_jit_needs_sdk(identity)
                or whatsapp_contact_send_needs_jit(identity)
            )
        )
    )
    mcp_sdk = None
    if needs_sdk:
        from .sdk import QlixSDK

        mcp_sdk = QlixSDK(identity=identity, http=http)
        mcp_sdk.set_run_context(
            run_id=run_id,
            conversation_id=conversation_id,
            team_run_id=team_run_id,
        )

    from .subagents import SubAgentRunContext

    subagent_context = SubAgentRunContext(
        agent_id=agent_id,
        parent_run_id=run_id,
        identity=identity,
        http=http,
        headers=headers,
        model=model,
        backend_url=backend_url,
        runner_token=runner_token,
        runner_runtime="cloud",
        tool_profile=tool_profile,
        mcp_servers=mcp_servers,
        qlix_sdk=mcp_sdk,
        depth=0,
        agent_description=agent_description,
    )

    tool_executors = router.build_executor_map(
        plan,
        agent_id=agent_id,
        run_id=run_id,
        backend_url=backend_url,
        runner_token=runner_token,
        qlix_sdk=mcp_sdk,
        mcp_servers=mcp_servers,
        subagent_context=subagent_context,
        live_tools=tools,
        team_id=team_id,
        has_context_refs=has_context_refs,
        enable_context_search=enable_context_search,
    )

    tools_json = json.dumps(tools, sort_keys=True)
    tools_hash = hashlib.md5(tools_json.encode()).hexdigest()[:8]

    # Tier A: invariant per agent -> cached prompt prefix.
    system_prompt = _build_system_prompt(agent_description, identity)
    # Tier B: everything that varies per run, appended after the cached prefix.
    granted_scopes = (
        set(identity.permission_scopes)
        | set(identity.always_scopes)
        | set(identity.jit_scopes)
    )
    enriched_prompt = build_run_context_block(
        prompt=enriched_prompt,
        granted_scopes=granted_scopes,
        guidance=_build_run_guidance(
            identity,
            groups=plan.groups,
            instruction=instruction,
            base_guidance=plan.guidance,
        ),
        tool_preference=router.tool_preference(plan),
    )

    # Capture UI screenshot frames whenever browser tools are in play, so the live
    # preview shows up as soon as the model navigates/clicks — not only when the user
    # explicitly asks to "see the browser". Set QLIX_BROWSER_LIVE_VIEW=0 to disable.
    live_view_enabled = "web" in plan.groups and os.environ.get(
        "QLIX_BROWSER_LIVE_VIEW", "1"
    ).strip().lower() not in ("0", "false", "off", "no")

    if "web" in plan.groups:
        try:
            from .browser_pool import ensure_managed_browser_env

            cdp = ensure_managed_browser_env()
            if cdp:
                _log("browser_pool_cdp", run_id=run_id, configured=True)
        except Exception as exc:  # noqa: BLE001
            _log("browser_pool_cdp_failed", run_id=run_id, error=str(exc)[:200])

    return await run_backend_proxy_inference(
        http,
        identity=identity,
        agent_id=agent_id,
        headers=headers,
        seq=seq,
        run_id=run_id,
        model=model,
        enriched_prompt=enriched_prompt,
        tools=tools,
        tool_executors=tool_executors,
        tools_hash=tools_hash,
        tools_schema_bytes=len(tools_json),
        log=default_log("cloud_runner"),
        system_prompt=system_prompt,
        live_view_enabled=live_view_enabled,
        subagent_context=subagent_context,
        reasoning_effort=reasoning_effort,
        context_components=context_components,
    )


async def _ping_loop() -> None:
    identity = load_identity()
    runner_token = os.environ.get("QLIX_RUNNER_TOKEN", "").strip()
    interval_ms_raw = os.environ.get("QLIX_CLOUD_PING_INTERVAL_MS", "5000").strip()
    try:
        interval_ms = max(1000, int(interval_ms_raw))
    except ValueError:
        interval_ms = 5000

    async with QlixHttpClient(base_url=identity.backend_url) as http:
        while True:
            t0 = time.time()
            try:
                await http.post_json(
                    f"/api/v1/agents/{identity.did}/ping",
                    {},
                    headers={"X-QLIX-Runner-Token": runner_token} if runner_token else None,
                )
            except Exception:
                # Keep going; backend may restart (don't log every retry)
                pass
            dt = time.time() - t0
            sleep_s = max(0.1, (interval_ms / 1000.0) - dt)
            await asyncio.sleep(sleep_s)


async def _poll_and_execute_loop() -> None:
    identity = load_identity()
    os.environ.setdefault("LUNA_BROWSER_ENGINE", "agent_browser")
    os.environ.setdefault("AGENT_BROWSER_SESSION", identity.agent_id)
    os.environ.setdefault("AGENT_BROWSER_SOCKET_DIR", "/tmp/agent-browser")
    if os.environ.get("LUNA_BROWSER_ENGINE", "").strip().lower() in (
        "agent_browser",
        "agent-browser",
        "agentbrowser",
    ):
        try:
            from qlix.luna.browser.warmup import warmup_agent_browser

            warmup_agent_browser(identity.agent_id)
            try:
                from qlix.luna.browser.factory import get_browser_engine_info

                _log("browser_engine_ready", **get_browser_engine_info())
            except Exception as info_exc:
                _log("browser_engine_info_error", error=str(info_exc))
        except Exception as exc:
            _log("agent_browser_warmup_error", error=str(exc))
            try:
                from qlix.browser_failover import activate_cloudflare_failover

                if activate_cloudflare_failover(reason=f"warmup: {exc}"):
                    _log("browser_failover_cloudflare", reason="warmup_failed")
            except Exception as failover_exc:  # noqa: BLE001
                _log("browser_failover_warmup_error", error=str(failover_exc)[:200])
    try:
        from qlix.cloud_research_runtime import configure_research_sources

        configure_research_sources()
        _log("agent_reach_configured")
    except Exception as exc:
        _log("agent_reach_config_error", error=str(exc))
    runner_token = os.environ.get("QLIX_RUNNER_TOKEN", "").strip()
    if not runner_token:
        _log("runner_init_error", message="missing QLIX_RUNNER_TOKEN")
        return

    adk = load_cloud_adk()
    # Always use backend_proxy with agent-browser tools (orchestrator mode removed)
    use_backend_proxy = True
    sdk = None
    runner = None
    boot_error = None
    _log(
        "poll_start",
        agent_id=identity.agent_id,
        backend=identity.backend_url,
        adk_name=adk.manifest.get("name"),
        adk_version=adk.manifest.get("manifestVersion"),
        inference_mode="backend_proxy" if use_backend_proxy else "local_runner",
    )

    headers = {"X-QLIX-Runner-Token": runner_token}
    seq = 0
    idle_polls = 0

    # Inference can take far longer than the 15s default (multi-turn LLM calls with
    # many tools), so use a dedicated long-timeout client for the proxy inference path.
    # Polling/event/complete calls keep the short-timeout `http` client below.
    inference_http = QlixHttpClient(base_url=identity.backend_url, timeout_s=120.0)
    async with QlixHttpClient(base_url=identity.backend_url) as http:
        while True:
            run_id = ""
            try:
                polled = await http.post_json(
                    f"/api/v1/agents/{identity.agent_id}/runs/poll",
                    {"maxWaitMs": 0, "runtime": "cloud"},
                    headers=headers,
                )
                from .runner_common import extract_polled_run, runner_completion_body
                run = extract_polled_run(polled, agent_id=identity.agent_id, runtime="cloud")
                if not run:
                    idle_polls += 1
                    if idle_polls % 15 == 0:
                        _log("poll_idle", agent_id=identity.agent_id, count=idle_polls)
                    await asyncio.sleep(1.0)
                    continue

                idle_polls = 0
                run_id = str(run.get("id", ""))
                prompt = str(run.get("prompt", ""))
                run_inference_model = str(
                    run.get("inferenceModel") or run.get("inference_model") or ""
                ).strip()
                run_reasoning_effort = str(
                    run.get("reasoningEffort") or run.get("reasoning_effort") or ""
                ).strip() or None
                skills = run.get("skills") or []
                selected_skills = [str(s).strip() for s in skills if str(s).strip()]
                allowed_tools = set(selected_skills) if selected_skills else None
                _log("run_claimed", run_id=run_id, skills=skills)
                seq = await _emit_event(
                    http,
                    agent_id=identity.agent_id,
                    run_id=run_id,
                    headers=headers,
                    seq=seq,
                    event_type="log",
                    data={"message": "run_started", "skills": skills},
                )
                seq = await _emit_event(
                    http,
                    agent_id=identity.agent_id,
                    run_id=run_id,
                    headers=headers,
                    seq=seq,
                    event_type="log",
                    data={"message": "luna_start"},
                )
                if os.environ.get("LUNA_BROWSER_ENGINE", "").strip().lower() in (
                    "agent_browser",
                    "agent-browser",
                    "agentbrowser",
                ):
                    try:
                        from qlix.luna.browser.factory import get_browser_engine_info

                        seq = await _emit_event(
                            http,
                            agent_id=identity.agent_id,
                            run_id=run_id,
                            headers=headers,
                            seq=seq,
                            event_type="log",
                            data={"message": "browser_engine_info", **get_browser_engine_info()},
                        )
                    except Exception as info_exc:
                        _log("browser_engine_info_error", run_id=run_id, error=str(info_exc))
                use_brain = bool(run.get("useBrain"))
                from .context_pack import assemble_run_prompt, pack_allows_context_search, pack_has_references, should_prepend_brain
                from .runner_common import brain_event_from_pack

                assembled_prompt, context_components = assemble_run_prompt(
                    prompt,
                    run.get("contextPack"),
                    run.get("memoryBlock"),
                )
                pack = run.get("contextPack")
                if should_prepend_brain(use_brain, pack):
                    prompt_for_skills, seq = await _maybe_prepend_brain_context(
                        http,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        headers=headers,
                        prompt=assembled_prompt,
                        use_brain=use_brain,
                        seq=seq,
                    )
                    if use_brain and prompt_for_skills != assembled_prompt:
                        from .context_pack import estimate_tokens as _estimate_tokens

                        context_components = {
                            **context_components,
                            "brain": max(
                                0,
                                _estimate_tokens(prompt_for_skills) - _estimate_tokens(assembled_prompt),
                            ),
                        }
                else:
                    prompt_for_skills = assembled_prompt
                    owned = brain_event_from_pack(pack) if use_brain else None
                    if owned:
                        seq = await _emit_event(
                            http,
                            agent_id=identity.agent_id,
                            run_id=run_id,
                            headers=headers,
                            seq=seq,
                            event_type="log",
                            data=owned,
                        )
                seq = await _emit_event(
                    http,
                    agent_id=identity.agent_id,
                    run_id=run_id,
                    headers=headers,
                    seq=seq,
                    event_type="log",
                    data={
                        "message": "context_pack",
                        "packId": (run.get("contextPack") or {}).get("packId")
                        if isinstance(run.get("contextPack"), dict)
                        else None,
                        "estimatedTokens": (run.get("contextPack") or {}).get("estimatedTokens")
                        if isinstance(run.get("contextPack"), dict)
                        else None,
                        "components": context_components,
                        "referenceCount": len((run.get("contextPack") or {}).get("references") or [])
                        if isinstance(run.get("contextPack"), dict)
                        else 0,
                    },
                    soft=True,
                )
                # Prepend the agent's memory only for legacy polls that omit contextPack.
                enriched_prompt = prompt_for_skills
                if isinstance(skills, list) and skills:
                    enriched_prompt = (
                        f"{prompt_for_skills}\n\nSelected skills/tools: {', '.join(map(str, skills))}"
                    )
                # Using backend_proxy with agent-browser tools (orchestrator mode removed)
                turns = 0
                tool_calls: list[str] = []
                duration_ms = 0
                model = run_inference_model or str(
                    adk.manifest.get("model")
                    or os.environ.get("QLIX_PROXY_MODEL", "openrouter/openai/gpt-4o-mini")
                )
                seq = await _emit_event(
                    http,
                    agent_id=identity.agent_id,
                    run_id=run_id,
                    headers=headers,
                    seq=seq,
                    event_type="log",
                    data={"message": "inference_request", "model": model},
                )
                from dataclasses import replace as dc_replace

                from .runner_common import identity_with_live_scopes
                from .tool_profiles import filter_scopes_by_tool_profile

                tool_profile = str(run.get("toolProfile") or run.get("tool_profile") or "full")
                # Prefer live DB scopes from poll over boot-time agent.json (scope edits).
                live_identity = identity_with_live_scopes(identity, run if isinstance(run, dict) else None)
                scoped_identity = dc_replace(
                    live_identity,
                    permission_scopes=tuple(
                        filter_scopes_by_tool_profile(
                            list(live_identity.permission_scopes), tool_profile
                        )
                    ),
                    always_scopes=tuple(
                        filter_scopes_by_tool_profile(
                            list(live_identity.always_scopes), tool_profile
                        )
                    ),
                )
                seq, content, duration_ms, turns, tool_calls, proxy_usage, _executed_tools = (
                    await _run_backend_proxy_inference(
                        inference_http,
                        identity=scoped_identity,
                        agent_id=identity.agent_id,
                        headers=headers,
                        seq=seq,
                        run_id=run_id,
                        model=model,
                        enriched_prompt=enriched_prompt,
                        selected_skills=selected_skills,
                        agent_description=run.get("agentDescription"),
                        mcp_servers=run.get("mcpServers") or [],
                        tool_profile=tool_profile,
                        askable_agents=run.get("askableAgents") or [],
                        reasoning_effort=run_reasoning_effort,
                        conversation_id=str(run.get("conversationId") or "") or None,
                        team_run_id=str(run.get("teamRunId") or "") or None,
                        team_id=str(run.get("teamId") or run.get("team_id") or "") or None,
                        context_components=context_components,
                        has_context_refs=pack_has_references(run.get("contextPack")),
                        enable_context_search=pack_allows_context_search(
                            run.get("contextPack"),
                            bool(run.get("useBrain")),
                        ),
                    )
                )
                seq = await emit_inference_result_events(
                    http,
                    agent_id=identity.agent_id,
                    run_id=run_id,
                    headers=headers,
                    seq=seq,
                    model=model,
                    provider=None,
                    usage=proxy_usage,
                    tool_calls=tool_calls,
                    content=content,
                    turns=turns,
                )

                await http.post_json(
                    f"/api/v1/agents/{identity.agent_id}/runs/{run_id}/complete",
                    runner_completion_body(run_id=run_id, ok=True, result=content),
                    headers=headers,
                )
                _log("run_complete", run_id=run_id, turns=turns, duration_ms=duration_ms)
            except Exception as exc:
                # Log only critical errors, not retries
                from .runner_common import RunCanceledError

                if isinstance(exc, RunCanceledError):
                    _log("run_canceled_by_user", run_id=run_id or "")
                    continue
                error_msg = str(exc)
                if "Unique constraint" not in error_msg and "Network" not in error_msg:
                    _log("poll_execute_error", error=error_msg)
                if "run_id" in locals() and run_id:
                    try:
                        await http.post_json(
                            f"/api/v1/agents/{identity.agent_id}/runs/{run_id}/complete",
                            runner_completion_body(run_id=run_id, ok=False, error_message=error_msg),
                            headers=headers,
                        )
                    except Exception:
                        pass
                await asyncio.sleep(1.0)


def main() -> None:
    async def _main() -> None:
        await asyncio.gather(_ping_loop(), _poll_and_execute_loop())

    asyncio.run(_main())


if __name__ == "__main__":
    main()
