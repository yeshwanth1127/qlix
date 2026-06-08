"""Hybrid runner — polls Qlix for runs, executes local tools, inference via backend proxy."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import time
from typing import Any

from .cloud_adk_loader import load_cloud_adk

from .exceptions import HttpError
from .http_client import QlixHttpClient
from .identity import AgentIdentity, load_identity
from .runner_common import (
    default_log,
    emit_event,
    maybe_prepend_brain_context,
    run_backend_proxy_inference,
    stream_assistant_deltas,
)
from .sdk import QlixSDK
from .agents3_proxy import Agents3RunContext
from .hybrid_document_pipeline import verify_and_complete_outcomes
from .tool_router import ToolRouter

_log = default_log("hybrid_runner")
_ping_error_logged = False
_poll_conn_error_logged = False


def _is_network_error(exc: Exception) -> bool:
    """True for transport/connection failures (backend unreachable), not HTTP 4xx/5xx."""
    return isinstance(exc, HttpError) and getattr(exc, "status_code", None) == 0


def _build_system_prompt(agent_description: str, wa_connector_id: str) -> str | None:
    parts: list[str] = []
    if agent_description:
        parts.append(agent_description)

    # Steer the model to the dedicated tools instead of refusing or hand-rolling.
    parts.append(
        "Producing documents and delivering them:\n"
        "- When asked to create or generate a PDF/document/report, you CAN do it: call the "
        "s3_create_pdf tool with the title and content (markdown supported). It writes a real "
        "PDF on the user's computer and returns its absolute path. NEVER tell the user to "
        "copy-paste text into Word — that is not acceptable.\n"
        "- To deliver a created file to the user on WhatsApp, call s3_send_whatsapp_document "
        "with the absolute file_path returned by s3_create_pdf.\n"
        "- Typical flow for 'make a PDF and send it on WhatsApp': read any needed source files, "
        "call s3_create_pdf, then call s3_send_whatsapp_document with the returned path.\n"
        "- Complete the ENTIRE request in this run. After a tool returns (e.g. after reading "
        "a file), immediately continue to the next required tool call instead of stopping. "
        "Only finish once every requested step (create, send, etc.) is actually done."
    )

    wa_url = os.environ.get("QLIX_WA_URL", "http://localhost:3939").rstrip("/")
    wa_secret = os.environ.get("QLIX_WA_SECRET", "").strip()
    if wa_connector_id and wa_secret:
        parts.append(
            "If s3_send_whatsapp_document is unavailable, you may instead send a file via "
            "s3_python:\n"
            "```python\n"
            "import urllib.request, json as _j\n"
            f'_req = urllib.request.Request("{wa_url}/send-document",\n'
            f'    data=_j.dumps({{"connector_id": "{wa_connector_id}", "file_path": "<absolute path>"}}).encode(),\n'
            f'    headers={{"X-Service-Secret": "{wa_secret}", "Content-Type": "application/json"}})\n'
            "urllib.request.urlopen(_req)\n"
            "```"
        )

    return "\n\n".join(parts) if parts else None


def _runner_token(identity: AgentIdentity) -> str:
    token = os.environ.get("QLIX_RUNNER_TOKEN", "").strip()
    if token:
        return token
    raw = identity.raw
    for key in ("runner_token", "runnerToken"):
        val = raw.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


async def _ping_loop(identity: AgentIdentity, runner_token: str) -> None:
    interval_ms_raw = os.environ.get("QLIX_HYBRID_PING_INTERVAL_MS", "5000").strip()
    try:
        interval_ms = max(1000, int(interval_ms_raw))
    except ValueError:
        interval_ms = 5000

    headers = {"X-QLIX-Runner-Token": runner_token}
    async with QlixHttpClient(base_url=identity.backend_url) as http:
        while True:
            t0 = time.time()
            try:
                await http.post_json(
                    f"/api/v1/agents/{identity.agent_id}/ping",
                    {},
                    headers=headers,
                )
                global _ping_error_logged
                _ping_error_logged = False
            except Exception as exc:
                if not _ping_error_logged:
                    _log("ping_error", error=str(exc))
                    _ping_error_logged = True
            dt = time.time() - t0
            await asyncio.sleep(max(0.1, (interval_ms / 1000.0) - dt))


async def _poll_and_execute_loop(identity: AgentIdentity, runner_token: str) -> None:
    if not runner_token:
        _log("runner_init_error", message="missing QLIX_RUNNER_TOKEN or runner_token in agent.json")
        return

    adk = load_cloud_adk()
    headers = {"X-QLIX-Runner-Token": runner_token}
    max_wait_ms = int(os.environ.get("QLIX_HYBRID_POLL_MAX_WAIT_MS", "25000"))
    router = ToolRouter(identity, runner_runtime="hybrid")
    run_cache: dict[str, str] = {}

    _log(
        "poll_start",
        agent_id=identity.agent_id,
        backend=identity.backend_url,
        adk_name=adk.manifest.get("name"),
    )

    inference_http = QlixHttpClient(base_url=identity.backend_url, timeout_s=120.0)
    async with QlixHttpClient(base_url=identity.backend_url) as http:
        async with QlixSDK(identity=identity, http=http) as qlix:
            seq = 0
            idle_polls = 0

            while True:
                run_id = ""
                try:
                    polled = await http.post_json(
                        f"/api/v1/agents/{identity.agent_id}/runs/poll",
                        {"maxWaitMs": max_wait_ms},
                        headers=headers,
                    )
                    global _poll_conn_error_logged
                    _poll_conn_error_logged = False
                    run = polled.get("run")
                    if not run:
                        idle_polls += 1
                        if idle_polls == 1:
                            _log(
                                "poll_waiting",
                                agent_id=identity.agent_id,
                                message="Connected. Send a message in Qlix chat to start a run.",
                            )
                        elif idle_polls % 30 == 0:
                            _log("poll_idle", agent_id=identity.agent_id, count=idle_polls)
                        await asyncio.sleep(1.0)
                        continue

                    idle_polls = 0
                    run_id = str(run.get("id", ""))
                    seq = 0
                    prompt = str(run.get("prompt", ""))
                    agent_description = str(run.get("agentDescription") or "").strip()
                    wa_connector_id = str(run.get("waConnectorId") or "").strip()
                    run_inference_model = str(
                        run.get("inferenceModel") or run.get("inference_model") or ""
                    ).strip()
                    skills = run.get("skills") or []
                    selected_skills = [str(s).strip() for s in skills if str(s).strip()]
                    _log("run_claimed", run_id=run_id, skills=skills)

                    seq = await emit_event(
                        http,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        headers=headers,
                        seq=seq,
                        event_type="log",
                        data={"message": "run_started", "skills": skills, "runtime": "hybrid"},
                    )
                    seq = await emit_event(
                        http,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        headers=headers,
                        seq=seq,
                        event_type="log",
                        data={"message": "hybrid_runner_start"},
                    )

                    use_brain = bool(run.get("useBrain"))
                    prompt_for_skills, seq = await maybe_prepend_brain_context(
                        http,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        headers=headers,
                        prompt=prompt,
                        use_brain=use_brain,
                        seq=seq,
                        log=_log,
                    )
                    enriched_prompt = prompt_for_skills
                    if selected_skills:
                        enriched_prompt = (
                            f"{prompt_for_skills}\n\nSelected skills/tools: {', '.join(selected_skills)}"
                        )

                    # The agent's standing description (set at creation) is the trusted
                    # source of intent — the per-run prompt can't always be relied on.
                    plan = router.plan_run(
                        prompt,
                        skill_filter=selected_skills or None,
                        context=agent_description,
                    )
                    _log("tool_router_plan", run_id=run_id, groups=list(plan.groups))

                    # Debug: explain why each local tool is / isn't offered. This makes a
                    # silently-dropped s3_create_pdf / s3_write_file visible in the run feed.
                    from .agents3_runtime import diagnose_local_tools

                    tool_diag = diagnose_local_tools(
                        identity,
                        groups=plan.groups,
                        skill_filter=plan.skill_filter,
                        instruction=plan.instruction,
                    )
                    dropped = [
                        d for d in tool_diag["decisions"]
                        if not d["offered"] and d["reason"] != "group_not_selected_or_read_only"
                    ]
                    _log(
                        "tool_filter_debug",
                        run_id=run_id,
                        granted_scopes=tool_diag["granted_scopes"],
                        read_only_intent=tool_diag["read_only_intent"],
                        skill_filter=tool_diag["skill_filter"],
                        offered_tools=tool_diag["offered_tools"],
                        dropped=[{"tool": d["tool"], "reason": d["reason"]} for d in dropped],
                    )
                    seq = await emit_event(
                        http,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        headers=headers,
                        seq=seq,
                        event_type="log",
                        data={
                            "message": "tool_filter_debug",
                            "granted_scopes": tool_diag["granted_scopes"],
                            "read_only_intent": tool_diag["read_only_intent"],
                            "skill_filter": tool_diag["skill_filter"],
                            "groups": tool_diag["groups"],
                            "offered_tools": tool_diag["offered_tools"],
                            "dropped_write_or_pdf_tools": [
                                {"tool": d["tool"], "reason": d["reason"]} for d in dropped
                            ],
                            "instruction_preview": tool_diag["instruction_preview"],
                        },
                    )

                    tools = router.build_tool_definitions(plan)

                    model = run_inference_model or str(
                        adk.manifest.get("model")
                        or os.environ.get("QLIX_PROXY_MODEL", "openrouter/openai/gpt-4o-mini")
                    )
                    # Make the model resolution explicit so a "switch" is never a mystery:
                    # shows what the UI/run sent vs what was actually used and why.
                    _log(
                        "model_resolved",
                        run_id=run_id,
                        model_used=model,
                        from_run=run_inference_model or None,
                        manifest_model=str(adk.manifest.get("model") or "") or None,
                        env_default=os.environ.get("QLIX_PROXY_MODEL") or "openrouter/openai/gpt-4o-mini",
                        source=(
                            "run_inference_model"
                            if run_inference_model
                            else ("manifest" if adk.manifest.get("model") else "env_default")
                        ),
                    )
                    async def _agents3_log_emit(data: dict) -> None:
                        nonlocal seq
                        seq = await emit_event(
                            http,
                            agent_id=identity.agent_id,
                            run_id=run_id,
                            headers=headers,
                            seq=seq,
                            event_type="log",
                            data=data,
                        )

                    agents3_context = Agents3RunContext(
                        agent_id=identity.agent_id,
                        runner_token=runner_token,
                        model=model,
                        run_id=run_id,
                        log_emit=_agents3_log_emit,
                    )
                    tool_executors = router.build_executor_map(
                        plan,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        backend_url=identity.backend_url,
                        runner_token=runner_token,
                        qlix_sdk=qlix,
                        run_cache=run_cache,
                        agents3_context=agents3_context,
                    )

                    tools_json = json.dumps(tools, sort_keys=True)
                    tools_hash = hashlib.md5(tools_json.encode()).hexdigest()[:8]
                    seq = await emit_event(
                        http,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        headers=headers,
                        seq=seq,
                        event_type="log",
                        data={
                            "message": "inference_request",
                            "model": model,
                            "tool_groups": list(plan.groups),
                            "tools_offered": len(tools),
                        },
                    )

                    seq, content, duration_ms, turns, tool_calls, proxy_usage, executed_tools = (
                        await run_backend_proxy_inference(
                            inference_http,
                            identity=identity,
                            agent_id=identity.agent_id,
                            headers=headers,
                            seq=seq,
                            run_id=run_id,
                            model=model,
                            enriched_prompt=enriched_prompt,
                            tools=tools,
                            tool_executors=tool_executors,
                            tools_hash=tools_hash,
                            tools_schema_bytes=len(tools_json),
                            log=_log,
                            live_view_enabled=False,
                            system_prompt=_build_system_prompt(agent_description, wa_connector_id),
                        )
                    )

                    # Verify the run's required outcomes against what actually
                    # happened; deterministically finish any the model skipped
                    # (e.g. created a file but never delivered it).
                    pipeline_tools, pipeline_summary = await verify_and_complete_outcomes(
                        prompt=enriched_prompt,
                        executed=executed_tools,
                        tool_executors=tool_executors,
                        log=_log,
                    )
                    if pipeline_tools:
                        tool_calls = list(tool_calls) + pipeline_tools
                        if pipeline_summary.strip():
                            content = pipeline_summary
                        seq = await emit_event(
                            http,
                            agent_id=identity.agent_id,
                            run_id=run_id,
                            headers=headers,
                            seq=seq,
                            event_type="log",
                            data={
                                "message": "document_pipeline_fallback",
                                "tools": pipeline_tools,
                            },
                        )
                    seq = await emit_event(
                        http,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        headers=headers,
                        seq=seq,
                        event_type="log",
                        data={
                            "message": "inference_success",
                            "model": model,
                            "usage": proxy_usage,
                            "tool_calls_executed": tool_calls,
                        },
                    )
                    seq = await stream_assistant_deltas(
                        http,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        headers=headers,
                        seq=seq,
                        content=content,
                    )
                    seq = await emit_event(
                        http,
                        agent_id=identity.agent_id,
                        run_id=run_id,
                        headers=headers,
                        seq=seq,
                        event_type="log",
                        data={"message": "run_result", "turns": turns, "tool_calls": tool_calls},
                    )

                    # Fallback when the model ends on tool calls with no final text —
                    # avoids delivering an empty message to the user/WhatsApp.
                    final_content = content.strip() if isinstance(content, str) else ""
                    if not final_content:
                        # tool_calls is the list of executed tool names; use its length.
                        tool_call_count = (
                            len(tool_calls) if isinstance(tool_calls, list) else int(tool_calls or 0)
                        )
                        if tool_call_count > 0:
                            final_content = (
                                f"Done — completed the task using {tool_call_count} tool "
                                f"call{'s' if tool_call_count != 1 else ''} across {turns} "
                                f"turn{'s' if turns != 1 else ''}."
                            )
                        else:
                            final_content = "Done — task completed."
                        _log(
                            "empty_content_fallback",
                            run_id=run_id,
                            tool_calls=tool_call_count,
                            turns=turns,
                        )

                    await http.post_json(
                        f"/api/v1/agents/{identity.agent_id}/runs/{run_id}/complete",
                        {"ok": True, "result": final_content},
                        headers=headers,
                    )
                    _log("run_complete", run_id=run_id, turns=turns, duration_ms=duration_ms)
                except Exception as exc:
                    import traceback as _tb
                    error_msg = str(exc)
                    # Backend unreachable before a run is claimed (e.g. backend still
                    # starting up) is transient: log once, back off quietly, no traceback.
                    if not run_id and _is_network_error(exc):
                        if not _poll_conn_error_logged:
                            _log(
                                "poll_waiting_backend",
                                backend=identity.backend_url,
                                message="Backend not reachable yet — retrying until it is up.",
                            )
                            _poll_conn_error_logged = True
                        await asyncio.sleep(2.0)
                        continue
                    _log("poll_execute_error", error=error_msg)
                    print("[hybrid_runner] TRACEBACK:\n" + _tb.format_exc(), file=__import__("sys").stderr, flush=True)
                    if run_id:
                        try:
                            await http.post_json(
                                f"/api/v1/agents/{identity.agent_id}/runs/{run_id}/complete",
                                {"ok": False, "errorMessage": error_msg},
                                headers=headers,
                            )
                        except Exception:
                            pass
                    await asyncio.sleep(1.0)


def main() -> None:
    identity = load_identity()
    runner_token = _runner_token(identity)
    if not runner_token:
        print(
            "[hybrid_runner] Set QLIX_RUNNER_TOKEN or include runner_token in agent.json",
            file=sys.stderr,
        )
        sys.exit(1)

    async def _main() -> None:
        await asyncio.gather(
            _ping_loop(identity, runner_token),
            _poll_and_execute_loop(identity, runner_token),
        )

    asyncio.run(_main())


if __name__ == "__main__":
    main()
