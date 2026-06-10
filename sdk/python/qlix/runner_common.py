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
from .hybrid_document_pipeline import wants_pdf_output
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


# Granted-scope -> human capability phrase. Driven by scopes (not the tools loaded
# this run) so the model always knows what it can do, even when keyword routing
# didn't load those tools this turn.
_SCOPE_CAPABILITY: list[tuple[str, str]] = [
    ("web.", "browse the web and read web pages"),
    ("email.", "read and send email"),
    ("brain.", "look up the organization's internal knowledge base"),
    ("system.file_", "read and write files on the user's computer"),
    ("system.gui_control", "control desktop applications"),
]


def describe_capabilities(granted_scopes: set[str], tools: list[dict[str, Any]]) -> str:
    """Natural-language capability summary for the system prompt.

    Capabilities come from the agent's GRANTED SCOPES (stable regardless of which
    tools a given run loads). The tool list reflects what is actually callable this
    run. Without this, models answer capability questions from their training prior
    (e.g. "I can't browse the internet") even when tools are attached.
    """
    phrases: list[str] = []
    for prefix, phrase in _SCOPE_CAPABILITY:
        if any(s.startswith(prefix) for s in granted_scopes) and phrase not in phrases:
            phrases.append(phrase)

    tool_lines: list[str] = []
    for t in tools:
        fn = t.get("function") if isinstance(t, dict) else None
        if not isinstance(fn, dict):
            continue
        name = str(fn.get("name", "")).strip()
        if not name or name in ("think", "done"):
            continue
        desc = str(fn.get("description", "")).strip().replace("\n", " ")
        if len(desc) > 120:
            desc = desc[:120] + "…"
        tool_lines.append(f"- {name}: {desc}" if desc else f"- {name}")

    parts: list[str] = [
        "You have REAL, working tools and can take actions by calling them — you are "
        "not a chat-only assistant."
    ]
    if phrases:
        parts.append("You are able to " + ", ".join(phrases) + ".")
    if tool_lines:
        parts.append("Tools you can call right now:\n" + "\n".join(tool_lines[:30]))
    parts.append(
        "When the user asks what you can do, or whether you can do something, answer "
        "based on these capabilities. Never claim you are unable to do something your "
        "tools enable (for example, do not say you cannot browse the internet when you "
        "have web access). Prefer calling a tool to actually do the task rather than "
        "asking the user to do it themselves."
    )
    return "\n\n".join(parts)


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
) -> tuple[int, str, int, int, list[str], dict[str, Any], list[dict[str, str]]]:
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
    # Full (name, args, output) records so callers can verify outcomes from
    # runtime state (e.g. the actual path a create-tool wrote) instead of
    # guessing the flow.
    executed_tools: list[dict[str, str]] = []
    # Times each exact (name, args) call has run. A round that only repeats calls
    # we've already executed this many times is a stuck no-op loop, not progress.
    executed_call_counts: dict[str, int] = {}
    tool_repeat_limit = int(os.environ.get("QLIX_PROXY_MAX_TOOL_REPEAT", "2"))
    usage_acc: dict[str, Any] = {}
    temperature = float(os.environ.get("QLIX_PROXY_TEMPERATURE", "0.2"))
    max_tokens = int(os.environ.get("QLIX_PROXY_MAX_TOKENS", "4096"))
    # Context engineering: keep only the most recent N tool outputs verbatim in the
    # re-sent message list; older ones are replaced with a tiny placeholder to save
    # context/cost (the full outputs are still preserved in `executed_tools`).
    keep_tool_msgs = int(os.environ.get("QLIX_PROXY_KEEP_TOOL_MSGS", "8"))
    # Track the largest context we send to the model so we can report it once.
    max_context_chars = 0
    content_out = ""
    inference_rounds = 0
    # Weak tool-callers (e.g. AI21 Jamba) sometimes run one tool then return empty
    # content with no further tool calls, abandoning a multi-step task. Nudge them
    # to either finish the remaining tool steps or give a real answer, bounded so
    # we never loop forever / burn credits.
    max_empty_nudges = int(os.environ.get("QLIX_PROXY_MAX_EMPTY_NUDGES", "2"))
    empty_nudges = 0
    force_tool_next_round = False

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

        context_chars = sum(len(str(m.get("content") or "")) for m in messages)
        if context_chars > max_context_chars:
            max_context_chars = context_chars

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
            tool_choice="required" if force_tool_next_round else "auto",
            tools_hash=tools_hash,
        )
        if force_tool_next_round:
            force_tool_next_round = False
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
            # Stuck no-op loop: the model keeps re-issuing calls it has already
            # run (e.g. echoing a path). Don't count it as progress — break and
            # let the outcome verifier finish or the run end cleanly.
            round_sigs = [
                f"{c['function']['name']}\x00{c['function']['arguments']}"
                for c in assistant_calls
            ]
            if round_sigs and all(
                executed_call_counts.get(sig, 0) >= tool_repeat_limit for sig in round_sigs
            ):
                log(
                    "proxy_tool_loop_stuck",
                    agent_id=agent_id,
                    run_id=run_id,
                    round=round_idx + 1,
                    repeated=[c["function"]["name"] for c in assistant_calls],
                )
                seq = await emit_event(
                    http,
                    agent_id=agent_id,
                    run_id=run_id,
                    headers=headers,
                    seq=seq,
                    event_type="log",
                    data={
                        "message": "tool_loop_stuck_break",
                        "round": round_idx + 1,
                        "tools": [c["function"]["name"] for c in assistant_calls],
                    },
                )
                content_out = content_out or proxy_result.content or ""
                break

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
                    # A single tool raising must never fail the whole run. Turn any
                    # exception into a failed tool result the model can read and
                    # recover from (executors already prefix failures with "[failed] ").
                    try:
                        if inspect.iscoroutinefunction(executor):
                            tool_out = await executor(args)
                        else:
                            tool_out = await asyncio.to_thread(executor, args)
                    except Exception as exc:  # noqa: BLE001 - defensive boundary
                        tool_out = f"[failed] {name} raised: {exc}"
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
                # Keep the full (untruncated) output so callers can extract paths.
                executed_tools.append(
                    {"name": name, "args": args, "output": str(tool_out)}
                )
                sig = f"{name}\x00{args}"
                executed_call_counts[sig] = executed_call_counts.get(sig, 0) + 1
                messages.append({"role": "tool", "tool_call_id": tid, "content": tool_out_truncated})
                # Surface tool failures to the UI: executors prefix failed results
                # with "[failed] ". Carry an ok flag + short error so the activity
                # timeline can render the failure inline instead of silently
                # showing "Done".
                tool_failed = isinstance(tool_out, str) and tool_out.startswith("[failed] ")
                finished_data: dict[str, object] = {
                    "message": "tool_finished",
                    "tool": name,
                    "ok": not tool_failed,
                }
                if tool_failed:
                    finished_data["error"] = tool_out[len("[failed] ") :].strip()[:500]
                seq = await emit_event(
                    http,
                    agent_id=agent_id,
                    run_id=run_id,
                    headers=headers,
                    seq=seq,
                    event_type="log",
                    data=finished_data,
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
            # After reading a source file for a PDF task, force the next model turn to
            # call a tool (usually s3_create_pdf) instead of returning empty text.
            if (
                "s3_read_file" in tool_names_ran
                and "s3_create_pdf" not in tool_names_ran
                and "s3_create_pdf" in tool_executors
                and wants_pdf_output(enriched_prompt)
            ):
                force_tool_next_round = True
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "The source file is loaded above. Call s3_create_pdf now with "
                            "a title and the file content as the PDF body. Do not stop after "
                            "reading — create the PDF in this run."
                        ),
                    }
                )

            # Tool-result clearing: keep only the most recent `keep_tool_msgs` tool
            # outputs verbatim; replace the content of older ones with a short
            # placeholder so we don't re-send stale dumps every round. Only the
            # `content` is changed (messages are never removed), so the
            # assistant tool_calls <-> tool_call_id pairing stays valid.
            if keep_tool_msgs >= 0:
                tool_idxs = [i for i, m in enumerate(messages) if m.get("role") == "tool"]
                for i in tool_idxs[:-keep_tool_msgs] if keep_tool_msgs else tool_idxs:
                    content = messages[i].get("content")
                    if isinstance(content, str) and not content.startswith("[cleared:"):
                        messages[i]["content"] = "[cleared: earlier tool output removed to save context]"
            continue

        content_out = proxy_result.content or ""
        # Degenerate stop: model produced neither a tool call nor any text. If it
        # already ran at least one tool, the task is very likely unfinished, so
        # nudge it to continue rather than ending on an empty reply.
        if (
            not content_out.strip()
            and tool_names_ran
            and empty_nudges < max_empty_nudges
            and time.time() <= deadline
        ):
            empty_nudges += 1
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "You stopped without a final answer and the task may not be "
                        "complete. If there are remaining steps, call the appropriate "
                        "tools now (for example create the document with s3_create_pdf, "
                        "then deliver it with s3_send_whatsapp_document). Once everything "
                        "is done, reply with a short confirmation. Do not ask the user to "
                        "do any of these steps manually."
                    ),
                }
            )
            seq = await emit_event(
                http,
                agent_id=agent_id,
                run_id=run_id,
                headers=headers,
                seq=seq,
                event_type="log",
                data={"message": "empty_response_nudge", "round": round_idx + 1, "nudge": empty_nudges},
            )
            continue
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
    # Context budget awareness: surface the peak context size (rough tokens ≈ chars/4)
    # in the run timeline so growth is visible.
    seq = await emit_event(
        http,
        agent_id=agent_id,
        run_id=run_id,
        headers=headers,
        seq=seq,
        event_type="log",
        data={
            "message": "context_size",
            "peakChars": max_context_chars,
            "approxTokens": max_context_chars // 4,
            "rounds": inference_rounds,
        },
    )
    return seq, content_out, duration_ms, inference_rounds, tool_names_ran, usage_acc, executed_tools
