"""Parent-only nested sub-agents (V1).

Spawns N logical children inside the parent tool loop via ``run_backend_proxy_inference``,
avoiding same-agent queued-run deadlock. Persistence goes through runner-auth APIs;
in-process asyncio tasks hold live results for ``await_subagents``.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from typing import Any

from .http_client import QlixHttpClient
from .identity import AgentIdentity


SUBAGENT_TOOL_NAMES: frozenset[str] = frozenset({"spawn_subagents", "await_subagents"})


def _env_int(name: str, default: int, *, lo: int = 1, hi: int = 64) -> int:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        n = int(str(raw).strip())
    except ValueError:
        return default
    return max(lo, min(hi, n))


def subagent_max_per_run() -> int:
    return _env_int("QLIX_SUBAGENT_MAX_PER_RUN", 8, lo=1, hi=32)


def subagent_max_parallel() -> int:
    return _env_int("QLIX_SUBAGENT_MAX_PARALLEL", 3, lo=1, hi=16)


def subagent_max_depth() -> int:
    return _env_int("QLIX_SUBAGENT_MAX_DEPTH", 1, lo=0, hi=4)


def subagent_child_max_rounds() -> int:
    parent = _env_int("QLIX_CLOUD_TOOL_MAX_ROUNDS", 15, lo=1, hi=64)
    return _env_int("QLIX_SUBAGENT_MAX_ROUNDS", max(4, parent // 2), lo=1, hi=parent)


def subagent_child_max_seconds() -> float:
    parent = float(os.environ.get("QLIX_CLOUD_TOOL_MAX_SECONDS", "200") or "200")
    raw = os.environ.get("QLIX_SUBAGENT_MAX_SECONDS")
    if raw and str(raw).strip():
        try:
            return max(10.0, min(parent, float(str(raw).strip())))
        except ValueError:
            pass
    return max(30.0, parent * 0.5)


@dataclass
class _LiveInvocation:
    invocation_id: str
    task: asyncio.Task[dict[str, Any]]
    status: str = "queued"
    result: dict[str, Any] | None = None


@dataclass
class SubAgentRunContext:
    """Per-parent-run registry of nested sub-agent tasks."""

    agent_id: str
    parent_run_id: str
    identity: AgentIdentity
    http: QlixHttpClient
    headers: dict[str, str]
    model: str
    backend_url: str
    runner_token: str
    runner_runtime: str = "cloud"
    tool_profile: str = "full"
    mcp_servers: Any = None
    qlix_sdk: Any = None
    depth: int = 0
    agent_description: str | None = None
    live: dict[str, _LiveInvocation] = field(default_factory=dict)
    _semaphore: asyncio.Semaphore | None = None

    def semaphore(self, max_parallel: int) -> asyncio.Semaphore:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(max(1, max_parallel))
        return self._semaphore


def openai_subagent_tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "spawn_subagents",
                "description": (
                    "Spawn one or more nested sub-agents for bounded side work. "
                    "Parent-only: children run in-process with a skill-filtered tool set "
                    "and cannot spawn further sub-agents (depth=1). "
                    "Returns invocation ids; pass wait=true to block until all finish, "
                    "or call await_subagents later."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tasks": {
                            "type": "array",
                            "description": "Subtasks to run (1..max per parent run).",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "prompt": {
                                        "type": "string",
                                        "description": "Instructions for this sub-agent",
                                    },
                                    "skills": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                        "description": "Optional skill/scope filter",
                                    },
                                    "name": {
                                        "type": "string",
                                        "description": "Short label for timeline/UI",
                                    },
                                },
                                "required": ["prompt"],
                            },
                        },
                        "maxParallel": {
                            "type": "integer",
                            "description": "Max concurrent nested loops (default from env)",
                        },
                        "wait": {
                            "type": "boolean",
                            "description": "If true, wait for all tasks and return results",
                        },
                        "timeoutSeconds": {
                            "type": "number",
                            "description": "When wait=true, overall timeout for the batch",
                        },
                    },
                    "required": ["tasks"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "await_subagents",
                "description": (
                    "Wait for previously spawned sub-agents and return their results. "
                    "Use after spawn_subagents with wait=false."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "invocationIds": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Ids returned by spawn_subagents",
                        },
                        "timeoutSeconds": {
                            "type": "number",
                            "description": "Max seconds to wait (default: child time budget)",
                        },
                    },
                    "required": ["invocationIds"],
                },
            },
        },
    ]


async def _patch_invocation(
    http: QlixHttpClient,
    *,
    agent_id: str,
    invocation_id: str,
    headers: dict[str, str],
    status: str,
    result: Any = None,
    error_message: str | None = None,
) -> None:
    body: dict[str, Any] = {"status": status}
    if result is not None:
        body["result"] = result
    if error_message is not None:
        body["errorMessage"] = error_message
    await http.patch_json(
        f"/api/v1/agents/{agent_id}/subagents/{invocation_id}",
        body,
        headers=headers,
    )


async def _run_one_nested(
    ctx: SubAgentRunContext,
    *,
    invocation_id: str,
    prompt: str,
    skills: list[str],
    name: str | None,
) -> dict[str, Any]:
    from .runner_common import (
        build_run_context_block,
        default_log,
        run_backend_proxy_inference,
    )
    from .tool_router import ToolRouter

    sem = ctx.semaphore(subagent_max_parallel())
    async with sem:
        try:
            await _patch_invocation(
                ctx.http,
                agent_id=ctx.agent_id,
                invocation_id=invocation_id,
                headers=ctx.headers,
                status="running",
            )
        except Exception:
            pass

        # Force reduced child budgets via kwargs (not env — parallel children would race).
        try:
            router = ToolRouter(ctx.identity, runner_runtime=ctx.runner_runtime)
            plan = router.plan_run(
                prompt,
                skill_filter=skills or None,
                context=ctx.agent_description or "",
            )
            tools = router.build_tool_definitions(
                plan, mcp_servers=ctx.mcp_servers, tool_profile=ctx.tool_profile
            )
            # Strip subagent tools from children even if env flags are on.
            tools = [
                t
                for t in tools
                if str((t.get("function") or {}).get("name") or "") not in SUBAGENT_TOOL_NAMES
                and str((t.get("function") or {}).get("name") or "") != "delegate_task"
            ]
            tool_executors = router.build_executor_map(
                plan,
                agent_id=ctx.agent_id,
                run_id=ctx.parent_run_id,
                backend_url=ctx.backend_url,
                runner_token=ctx.runner_token,
                qlix_sdk=ctx.qlix_sdk,
                mcp_servers=ctx.mcp_servers,
                # Nested children must not get a SubAgentRunContext (depth gate).
                subagent_context=None,
            )
            for name_drop in (*SUBAGENT_TOOL_NAMES, "delegate_task"):
                tool_executors.pop(name_drop, None)

            granted = (
                set(ctx.identity.permission_scopes)
                | set(ctx.identity.always_scopes)
                | set(ctx.identity.jit_scopes)
            )
            label = name or invocation_id[:8]
            enriched = build_run_context_block(
                prompt=(
                    f"[Sub-agent: {label}]\n"
                    f"You are a nested worker of the parent agent. Complete only this subtask.\n"
                    f"Do not spawn further sub-agents.\n\n{prompt}"
                ),
                granted_scopes=granted,
                guidance=plan.guidance,
                tool_preference=router.tool_preference(plan),
            )
            system_prompt = (
                "You are a focused sub-agent. Solve the assigned subtask and return a clear result. "
                "Do not call spawn_subagents or delegate_task."
            )
            if ctx.agent_description:
                system_prompt = f"{system_prompt}\n\nParent agent context:\n{ctx.agent_description[:1500]}"

            _seq, content, _dur, rounds, tool_names, usage, _executed = await run_backend_proxy_inference(
                ctx.http,
                identity=ctx.identity,
                agent_id=ctx.agent_id,
                headers=ctx.headers,
                seq=0,
                run_id=ctx.parent_run_id,
                model=ctx.model,
                enriched_prompt=enriched,
                tools=tools,
                tool_executors=tool_executors,
                tools_hash=f"sub:{invocation_id[:8]}",
                tools_schema_bytes=len(json.dumps(tools)),
                log=default_log(f"subagent:{label}"),
                system_prompt=system_prompt,
                live_view_enabled=False,
                max_rounds=subagent_child_max_rounds(),
                max_seconds=subagent_child_max_seconds(),
            )
            payload = {
                "id": invocation_id,
                "status": "completed",
                "content": content or "",
                "rounds": rounds,
                "tools": tool_names,
                "usage": usage,
                "name": name,
            }
            try:
                await _patch_invocation(
                    ctx.http,
                    agent_id=ctx.agent_id,
                    invocation_id=invocation_id,
                    headers=ctx.headers,
                    status="completed",
                    result=payload,
                )
            except Exception:
                pass
            return payload
        except Exception as exc:  # noqa: BLE001
            payload = {
                "id": invocation_id,
                "status": "failed",
                "content": "",
                "error": str(exc)[:2000],
                "name": name,
            }
            try:
                await _patch_invocation(
                    ctx.http,
                    agent_id=ctx.agent_id,
                    invocation_id=invocation_id,
                    headers=ctx.headers,
                    status="failed",
                    result=payload,
                    error_message=str(exc)[:2000],
                )
            except Exception:
                pass
            return payload


def build_subagent_executors(ctx: SubAgentRunContext) -> dict[str, Any]:
    """Return async spawn/await executors bound to a parent run context."""

    async def _spawn_subagents(args_json: str) -> str:
        if ctx.depth >= subagent_max_depth():
            return "[failed] Nested sub-agents cannot spawn further sub-agents (max depth reached)."

        params = json.loads(args_json) if args_json.strip() else {}
        tasks_in = params.get("tasks")
        if not isinstance(tasks_in, list) or not tasks_in:
            return "[failed] tasks must be a non-empty array"

        max_per = subagent_max_per_run()
        if len(tasks_in) > max_per:
            return f"[failed] At most {max_per} sub-agents per spawn (got {len(tasks_in)})"

        normalized: list[dict[str, Any]] = []
        for raw in tasks_in:
            if not isinstance(raw, dict):
                return "[failed] each task must be an object with prompt"
            prompt = str(raw.get("prompt") or "").strip()
            if not prompt:
                return "[failed] each task requires prompt"
            skills_raw = raw.get("skills") or []
            skills = [str(s).strip() for s in skills_raw if str(s).strip()] if isinstance(skills_raw, list) else []
            name = str(raw.get("name") or "").strip() or None
            normalized.append({"prompt": prompt, "skills": skills, "name": name})

        max_parallel = int(params.get("maxParallel") or subagent_max_parallel())
        max_parallel = max(1, min(max_parallel, subagent_max_parallel()))
        # Reset semaphore for this batch size if not yet created.
        if ctx._semaphore is None:
            ctx._semaphore = asyncio.Semaphore(max_parallel)

        body = {
            "tasks": normalized,
            "depth": ctx.depth + 1,
            "maxParallel": max_parallel,
        }
        try:
            created = await ctx.http.post_json(
                f"/api/v1/agents/{ctx.agent_id}/runs/{ctx.parent_run_id}/subagents",
                body,
                headers=ctx.headers,
            )
        except Exception as exc:  # noqa: BLE001
            return f"[failed] spawn_subagents: {exc}"

        invocations = created.get("invocations") if isinstance(created, dict) else None
        if not isinstance(invocations, list) or not invocations:
            return f"[failed] spawn_subagents: unexpected response {created!r}"

        ids: list[str] = []
        for inv, task_spec in zip(invocations, normalized):
            inv_id = str(inv.get("id") or "")
            if not inv_id:
                continue
            ids.append(inv_id)
            coro = _run_one_nested(
                ctx,
                invocation_id=inv_id,
                prompt=task_spec["prompt"],
                skills=task_spec["skills"],
                name=task_spec.get("name"),
            )
            task = asyncio.create_task(coro, name=f"subagent:{inv_id}")
            ctx.live[inv_id] = _LiveInvocation(invocation_id=inv_id, task=task, status="queued")

            def _done_cb(t: asyncio.Task[dict[str, Any]], *, _id=inv_id) -> None:
                live = ctx.live.get(_id)
                if not live:
                    return
                try:
                    live.result = t.result()
                    live.status = str((live.result or {}).get("status") or "completed")
                except Exception as exc:  # noqa: BLE001
                    live.result = {
                        "id": _id,
                        "status": "failed",
                        "error": str(exc)[:2000],
                        "content": "",
                    }
                    live.status = "failed"

            task.add_done_callback(_done_cb)

        wait = bool(params.get("wait"))
        if wait:
            timeout = params.get("timeoutSeconds")
            timeout_s = float(timeout) if timeout is not None else subagent_child_max_seconds() * 1.5
            return await _await_ids(ctx, ids, timeout_s=timeout_s)

        return json.dumps({"invocationIds": ids, "status": "spawned"}, ensure_ascii=False)

    async def _await_subagents(args_json: str) -> str:
        params = json.loads(args_json) if args_json.strip() else {}
        ids_raw = params.get("invocationIds") or params.get("invocation_ids") or []
        if not isinstance(ids_raw, list) or not ids_raw:
            return "[failed] invocationIds must be a non-empty array"
        ids = [str(i).strip() for i in ids_raw if str(i).strip()]
        timeout = params.get("timeoutSeconds")
        timeout_s = float(timeout) if timeout is not None else subagent_child_max_seconds() * 1.5
        return await _await_ids(ctx, ids, timeout_s=timeout_s)

    return {
        "spawn_subagents": _spawn_subagents,
        "await_subagents": _await_subagents,
    }


async def _await_ids(ctx: SubAgentRunContext, ids: list[str], *, timeout_s: float) -> str:
    results: list[dict[str, Any]] = []
    pending_tasks: list[asyncio.Task[dict[str, Any]]] = []
    id_for_task: dict[asyncio.Task[dict[str, Any]], str] = {}

    for inv_id in ids:
        live = ctx.live.get(inv_id)
        if live and live.result is not None:
            results.append(live.result)
            continue
        if live and not live.task.done():
            pending_tasks.append(live.task)
            id_for_task[live.task] = inv_id
            continue
        if live and live.task.done():
            try:
                results.append(live.task.result())
            except Exception as exc:  # noqa: BLE001
                results.append({"id": inv_id, "status": "failed", "error": str(exc), "content": ""})
            continue
        # Fall back to backend poll for persistence-only view.
        try:
            remote = await ctx.http.get_json(
                f"/api/v1/agents/{ctx.agent_id}/subagents/{inv_id}",
                headers=ctx.headers,
            )
            inv = remote.get("invocation") if isinstance(remote, dict) else None
            if isinstance(inv, dict) and inv.get("status") in ("completed", "failed", "canceled"):
                result = inv.get("result") if isinstance(inv.get("result"), dict) else {}
                results.append(
                    {
                        "id": inv_id,
                        "status": inv.get("status"),
                        "content": result.get("content", "") if isinstance(result, dict) else "",
                        "error": inv.get("errorMessage"),
                        "name": inv.get("name"),
                    }
                )
                continue
        except Exception:
            pass
        results.append({"id": inv_id, "status": "unknown", "content": "", "error": "not found in this run"})

    if pending_tasks:
        done, not_done = await asyncio.wait(pending_tasks, timeout=max(1.0, timeout_s))
        for t in done:
            inv_id = id_for_task.get(t, "")
            try:
                results.append(t.result())
            except Exception as exc:  # noqa: BLE001
                results.append({"id": inv_id, "status": "failed", "error": str(exc), "content": ""})
        for t in not_done:
            inv_id = id_for_task.get(t, "")
            results.append(
                {
                    "id": inv_id,
                    "status": "running",
                    "content": "",
                    "error": f"timed out after {timeout_s}s",
                }
            )

    return json.dumps({"results": results}, ensure_ascii=False)


def auto_subagent_on_budget_enabled() -> bool:
    raw = (os.environ.get("QLIX_AUTO_SUBAGENT_ON_BUDGET") or "1").strip().lower()
    return raw not in ("0", "false", "off", "no")


def _truncate(text: str, limit: int) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 20)] + "\n…[truncated]"


async def continue_via_subagent_on_budget(
    ctx: SubAgentRunContext,
    *,
    original_prompt: str,
    tool_names_ran: list[str],
    executed_tools: list[dict[str, str]],
    reason: str,
    log: Any = None,
) -> str | None:
    """Spawn one nested worker when the parent hits round/time budget.

    Returns the child's final content, or None when spawning is skipped/failed
    so the caller can keep the original stop message.
    """
    if not auto_subagent_on_budget_enabled():
        return None
    if ctx.depth >= subagent_max_depth():
        if log:
            log(
                "budget_subagent_skipped",
                reason="max_depth",
                depth=ctx.depth,
                budget_reason=reason,
            )
        return None

    recent = executed_tools[-12:]
    lines: list[str] = []
    for step in recent:
        name = str(step.get("name") or "?")
        out = _truncate(str(step.get("output") or ""), 350)
        lines.append(f"- {name}: {out}")
    tools_summary = "\n".join(lines) if lines else "(no tool outputs yet)"
    reason_label = "round budget" if reason == "round_budget" else "time budget"
    prompt = (
        f"Parent agent stopped because the tool-loop {reason_label} was reached. "
        f"Continue and finish the user's task. Do not restart from scratch — "
        f"reuse successful work and fix remaining failures.\n\n"
        f"Original task:\n{_truncate(original_prompt, 4500)}\n\n"
        f"Tools already used ({len(tool_names_ran)} calls): "
        f"{', '.join(tool_names_ran[-20:]) or '(none)'}\n\n"
        f"Recent tool results:\n{tools_summary}\n\n"
        f"Return a clear final answer for the user when done."
    )
    prompt = _truncate(prompt, 7800)

    body = {
        "tasks": [
            {
                "prompt": prompt,
                "skills": [],
                "name": f"budget-continue-{reason.replace('_', '-')}",
            }
        ],
        "depth": ctx.depth + 1,
        "maxParallel": 1,
    }
    if log:
        log(
            "budget_subagent_spawn",
            budget_reason=reason,
            depth=ctx.depth,
            prior_tools=len(tool_names_ran),
        )
    try:
        created = await ctx.http.post_json(
            f"/api/v1/agents/{ctx.agent_id}/runs/{ctx.parent_run_id}/subagents",
            body,
            headers=ctx.headers,
        )
    except Exception as exc:  # noqa: BLE001
        if log:
            log("budget_subagent_spawn_failed", error=str(exc)[:300])
        return None

    invocations = created.get("invocations") if isinstance(created, dict) else None
    if not isinstance(invocations, list) or not invocations:
        if log:
            log("budget_subagent_spawn_failed", error="empty invocations")
        return None

    inv = invocations[0] if isinstance(invocations[0], dict) else {}
    inv_id = str(inv.get("id") or "")
    if not inv_id:
        return None

    # Child context: depth+1 so nested auto-continue respects max depth.
    child_ctx = SubAgentRunContext(
        agent_id=ctx.agent_id,
        parent_run_id=ctx.parent_run_id,
        identity=ctx.identity,
        http=ctx.http,
        headers=ctx.headers,
        model=ctx.model,
        backend_url=ctx.backend_url,
        runner_token=ctx.runner_token,
        runner_runtime=ctx.runner_runtime,
        tool_profile=ctx.tool_profile,
        mcp_servers=ctx.mcp_servers,
        qlix_sdk=ctx.qlix_sdk,
        depth=ctx.depth + 1,
        agent_description=ctx.agent_description,
    )
    try:
        result = await _run_one_nested(
            child_ctx,
            invocation_id=inv_id,
            prompt=prompt,
            skills=[],
            name=str(inv.get("name") or "budget-continue"),
        )
    except Exception as exc:  # noqa: BLE001
        if log:
            log("budget_subagent_run_failed", error=str(exc)[:300], invocation_id=inv_id)
        return None

    content = str((result or {}).get("content") or "").strip()
    status = str((result or {}).get("status") or "")
    if log:
        log(
            "budget_subagent_done",
            invocation_id=inv_id,
            status=status,
            content_chars=len(content),
            budget_reason=reason,
        )
    if not content:
        err = str((result or {}).get("error") or "").strip()
        if err:
            return f"Continuation sub-agent failed: {err}"
        return None
    return content
