"""Shared helpers for cloud and hybrid runners (poll loop, events, brain, inference)."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import os
import re
import sys
import time
from typing import Any, Callable

from .backend_inference_client import backend_proxy_chat_completion
from .cloud_browser_runtime import (
    browser_action_label,
    capture_browser_frame_for_ui,
    goal_requests_live_view,
    should_capture_browser_frame,
    smart_truncate_tool_result,
)
from .http_client import QlixHttpClient
from .identity import AgentIdentity

LogFn = Callable[..., None]


def default_log(prefix: str) -> LogFn:
    def _log(stage: str, **kwargs: object) -> None:
        payload = {"stage": stage, **kwargs}
        print(f"[{prefix}] {json.dumps(payload, ensure_ascii=False)}", file=sys.stderr, flush=True)

    return _log


async def emit_event(
    http: QlixHttpClient,
    *,
    agent_id: str,
    run_id: str,
    headers: dict[str, str],
    seq: int,
    event_type: str,
    data: dict[str, object],
) -> int:
    await http.post_json(
        f"/api/v1/agents/{agent_id}/runs/{run_id}/event",
        {"seq": seq, "type": event_type, "data": data},
        headers=headers,
    )
    return seq + 1


def context_sections_from_block(block: str) -> list[dict[str, object]]:
    if not block.strip():
        return []
    sections: list[dict[str, object]] = []
    for part in re.split(r"\n\n---\n\n", block.strip()):
        part = part.strip()
        if not part:
            continue
        match = re.match(
            r'\[(\d+)\]\s+Collection:\s+"([^"]*)"\s+\|\s+Document:\s+"([^"]*)"\s*\n([\s\S]*)',
            part,
        )
        if match:
            sections.append(
                {
                    "index": int(match.group(1)),
                    "collectionName": match.group(2),
                    "documentTitle": match.group(3),
                    "excerpt": match.group(4).strip(),
                }
            )
        else:
            sections.append({"excerpt": part[:4000]})
        if len(sections) >= 5:
            break
    return sections


def brain_event_payload(resp: dict[str, Any]) -> dict[str, object]:
    citations = resp.get("citations") if isinstance(resp.get("citations"), list) else []
    titles: list[str] = []
    for c in citations[:5]:
        if not isinstance(c, dict):
            continue
        title = str(c.get("documentTitle") or c.get("collectionName") or "").strip()
        if title:
            titles.append(title)
    block = resp.get("contextBlock") if isinstance(resp.get("contextBlock"), str) else ""
    context_sections = context_sections_from_block(block)
    preview = " · ".join(titles) if titles else (block[:200] if block else "No matching policy found")
    return {
        "message": "tool_finished",
        "tool": "brain.query",
        "citationCount": len(citations),
        "policyPreview": preview,
        "citationTitles": titles,
        "citations": citations[:5],
        "contextSections": context_sections,
        "contextExcerpt": block[:8000] if block else "",
    }


async def maybe_prepend_brain_context(
    http: QlixHttpClient,
    *,
    agent_id: str,
    run_id: str,
    headers: dict[str, str],
    prompt: str,
    use_brain: bool,
    seq: int,
    log: LogFn,
) -> tuple[str, int]:
    if not use_brain:
        return prompt, seq
    try:
        resp = await http.post_json(
            f"/api/v1/agents/{agent_id}/runs/{run_id}/brain/query",
            {"contextOnly": True},
            headers=headers,
        )
    except Exception as exc:
        log("brain_context_error", run_id=run_id, error=str(exc))
        seq = await emit_event(
            http,
            agent_id=agent_id,
            run_id=run_id,
            headers=headers,
            seq=seq,
            event_type="log",
            data={
                "message": "tool_finished",
                "tool": "brain.query",
                "citationCount": 0,
                "policyPreview": f"Brain query failed: {exc}",
                "citationTitles": [],
                "citations": [],
            },
        )
        return prompt, seq
    if not isinstance(resp, dict):
        return prompt, seq
    seq = await emit_event(
        http,
        agent_id=agent_id,
        run_id=run_id,
        headers=headers,
        seq=seq,
        event_type="log",
        data=brain_event_payload(resp),
    )
    block = resp.get("contextBlock")
    if not isinstance(block, str) or not block.strip():
        return prompt, seq
    return f"{block}\n\n---\n\nUser task:\n{prompt}", seq


def get_adaptive_settle_time(tool_name: str) -> float:
    if tool_name in ("browser_navigate", "browser_ab_open"):
        return 0.5
    if tool_name in (
        "browser_click",
        "browser_type",
        "browser_ab_click",
        "browser_ab_dblclick",
        "browser_ab_fill",
        "browser_ab_type",
        "browser_ab_check",
        "browser_ab_uncheck",
        "browser_ab_select",
        "browser_ab_upload",
    ):
        return 0.15
    if tool_name in ("browser_ab_hover", "browser_ab_scroll", "browser_ab_scrollinto"):
        return 0.1
    if tool_name in ("browser_screenshot", "browser_ab_screenshot"):
        return 0.0
    return 0.0


async def stream_assistant_deltas(
    http: QlixHttpClient,
    *,
    agent_id: str,
    run_id: str,
    headers: dict[str, str],
    seq: int,
    content: str,
) -> int:
    if not content.strip():
        content = "No response generated."
    for word in content.split(" "):
        seq = await emit_event(
            http,
            agent_id=agent_id,
            run_id=run_id,
            headers=headers,
            seq=seq,
            event_type="delta",
            data={"text": word + " "},
        )
    return seq


async def run_backend_proxy_inference(
    http: QlixHttpClient,
    *,
    identity: AgentIdentity,
    agent_id: str,
    headers: dict[str, str],
    seq: int,
    run_id: str,
    model: str,
    enriched_prompt: str,
    tools: list[dict[str, Any]],
    tool_executors: dict[str, callable],
    tools_hash: str,
    tools_schema_bytes: int,
    log: LogFn,
    live_view_enabled: bool | None = None,
    system_prompt: str | None = None,
) -> tuple[int, str, int, int, list[str], dict[str, Any]]:
    """Multi-turn inference with pre-bound tool executors."""
    if live_view_enabled is None:
        live_view_enabled = goal_requests_live_view(enriched_prompt)

    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": enriched_prompt})
    max_rounds = int(os.environ.get("QLIX_CLOUD_TOOL_MAX_ROUNDS", "12"))
    max_seconds = float(os.environ.get("QLIX_CLOUD_TOOL_MAX_SECONDS", "150"))
    log(
        "proxy_tool_loop_start",
        agent_id=agent_id,
        run_id=run_id,
        max_rounds=max_rounds,
        tools_offered=len(tools),
        tools_hash=tools_hash,
    )
    deadline = time.time() + max_seconds
    started = time.time()
    tool_names_ran: list[str] = []
    usage_acc: dict[str, Any] = {}
    temperature = float(os.environ.get("QLIX_PROXY_TEMPERATURE", "0.2"))
    max_tokens = int(os.environ.get("QLIX_PROXY_MAX_TOKENS", "4096"))
    content_out = ""
    inference_rounds = 0

    for round_idx in range(max_rounds):
        inference_rounds += 1
        if time.time() > deadline:
            content_out = content_out or "Stopped: tool loop time budget exceeded."
            break

        if round_idx > 0:
            try:
                inj = await http.get_json(
                    f"/api/v1/agents/{agent_id}/runs/{run_id}/injections",
                    headers=headers,
                ) or {}
                for msg in (inj.get("messages") or []):
                    if msg:
                        messages.append({"role": "user", "content": f"[User guidance]: {msg}"})
            except Exception:
                pass

        proxy_result = await backend_proxy_chat_completion(
            http,
            agent_id=agent_id,
            headers=headers,
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            run_id=run_id,
            tools=tools,
            tool_choice="auto",
            tools_hash=tools_hash,
        )
        if isinstance(proxy_result.usage, dict):
            usage_acc.update(proxy_result.usage)

        tc_list = proxy_result.tool_calls
        if tc_list:
            assistant_calls: list[dict[str, Any]] = []
            for tc in tc_list:
                if not isinstance(tc, dict):
                    continue
                tid = str(tc.get("id", ""))
                typ = str(tc.get("type", "function"))
                fn = tc.get("function")
                if not isinstance(fn, dict):
                    continue
                name = str(fn.get("name", ""))
                args = str(fn.get("arguments", ""))
                if tid and name:
                    assistant_calls.append(
                        {"id": tid, "type": typ, "function": {"name": name, "arguments": args}}
                    )
            messages.append({"role": "assistant", "content": None, "tool_calls": assistant_calls})
            seq = await emit_event(
                http,
                agent_id=agent_id,
                run_id=run_id,
                headers=headers,
                seq=seq,
                event_type="log",
                data={
                    "message": "inference_tool_round",
                    "round": round_idx + 1,
                    "tools": [c["function"]["name"] for c in assistant_calls],
                },
            )

            async def _execute_single_tool(tc_item: dict[str, Any]) -> dict[str, Any] | None:
                if not isinstance(tc_item, dict):
                    return None
                fn = tc_item.get("function") if isinstance(tc_item.get("function"), dict) else {}
                name = str(fn.get("name", ""))
                args = str(fn.get("arguments", ""))
                tid = str(tc_item.get("id", ""))
                if not name or not tid:
                    return None
                executor = tool_executors.get(name)
                if executor:
                    if inspect.iscoroutinefunction(executor):
                        tool_out = await executor(args)
                    else:
                        tool_out = await asyncio.to_thread(executor, args)
                else:
                    tool_out = (
                        f"Tool '{name}' is not available for this task. "
                        f"Available: {', '.join(sorted(tool_executors.keys())[:20])}"
                    )
                return {"tid": tid, "name": name, "args": args, "output": tool_out}

            for tc_item in tc_list:
                if not isinstance(tc_item, dict):
                    continue
                fn_pre = tc_item.get("function") if isinstance(tc_item.get("function"), dict) else {}
                pre_name = str(fn_pre.get("name", ""))
                if pre_name:
                    started_data: dict[str, object] = {
                        "message": "tool_started",
                        "tool": pre_name,
                    }
                    if pre_name == "gui_control" or pre_name.startswith("s3_"):
                        started_data["package"] = "agents3"
                    seq = await emit_event(
                        http,
                        agent_id=agent_id,
                        run_id=run_id,
                        headers=headers,
                        seq=seq,
                        event_type="log",
                        data=started_data,
                    )

            tool_results = await asyncio.gather(
                *[_execute_single_tool(tc) for tc in tc_list],
                return_exceptions=False,
            )

            for result in tool_results:
                if not result:
                    continue
                tid = result["tid"]
                name = result["name"]
                args = result["args"]
                tool_out = result["output"]
                tool_out_truncated, _ = smart_truncate_tool_result(name, tool_out)
                tool_names_ran.append(name)
                messages.append({"role": "tool", "tool_call_id": tid, "content": tool_out_truncated})
                seq = await emit_event(
                    http,
                    agent_id=agent_id,
                    run_id=run_id,
                    headers=headers,
                    seq=seq,
                    event_type="log",
                    data={"message": "tool_finished", "tool": name},
                )

                if should_capture_browser_frame(name):
                    try:
                        params = json.loads(args) if args.strip() else {}
                        if not isinstance(params, dict):
                            params = {}
                    except json.JSONDecodeError:
                        params = {}
                    settle_time = get_adaptive_settle_time(name)
                    if settle_time > 0:
                        await asyncio.sleep(settle_time)
                    frame = await asyncio.to_thread(capture_browser_frame_for_ui, live_view_enabled)
                    if frame:
                        seq = await emit_event(
                            http,
                            agent_id=agent_id,
                            run_id=run_id,
                            headers=headers,
                            seq=seq,
                            event_type="log",
                            data={
                                "message": "browser_frame",
                                "tool": name,
                                "label": browser_action_label(name, params),
                                **frame,
                            },
                        )
                if name == "gui_control" and isinstance(tool_out, str) and tool_out.startswith("GUI_FRAME:"):
                    try:
                        frame_json = tool_out.split("GUI_FRAME:", 1)[1].strip()
                        frame_data = json.loads(frame_json)
                        if isinstance(frame_data, dict):
                            seq = await emit_event(
                                http,
                                agent_id=agent_id,
                                run_id=run_id,
                                headers=headers,
                                seq=seq,
                                event_type="log",
                                data={"message": "gui_frame", **frame_data},
                            )
                    except (json.JSONDecodeError, IndexError):
                        pass
            continue

        content_out = proxy_result.content or ""
        break

    duration_ms = int((time.time() - started) * 1000)
    log(
        "proxy_tool_loop_done",
        agent_id=agent_id,
        run_id=run_id,
        inference_rounds=inference_rounds,
        tools_executed=tool_names_ran,
        duration_ms=duration_ms,
    )
    return seq, content_out, duration_ms, inference_rounds, tool_names_ran, usage_acc
