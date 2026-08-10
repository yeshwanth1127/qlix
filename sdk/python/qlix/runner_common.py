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
from urllib.parse import urlparse

from .backend_inference_client import backend_proxy_chat_completion
from .hybrid_document_pipeline import wants_pdf_output
from .cloud_browser_runtime import (
    browser_action_label,
    capture_browser_frame_for_ui,
    goal_requests_live_view,
    is_browser_tool,
    sanitize_tool_args_for_ui,
    should_capture_browser_frame,
    smart_truncate_tool_result,
    truncation_key,
)
from .http_client import QlixHttpClient
from .identity import AgentIdentity

LogFn = Callable[..., None]

# Tools safe to run concurrently when the model batches multiple calls.
_READ_ONLY_TOOL_PREFIXES = (
    "research_",
    "browser_ab_get",
    "browser_ab_is",
    "browser_ab_find",
    "browser_ab_snapshot",
    "browser_ab_console",
    "browser_ab_errors",
    "browser_ab_highlight",
    "luna_local_read_",
    "luna_local_list_",
    "luna_local_open_",
    "luna_local_search_",
    "luna_local_pwd",
    "luna_local_cd",
    "crm_describe",
    "crm_get",
    "crm_search",
    "crm_list",
    "think",
    "find_tools",
)


def is_read_only_tool(name: str) -> bool:
    n = (name or "").strip()
    if n in ("think", "find_tools", "done", "luna_local_pwd", "luna_local_cd", "luna_local_search_files"):
        return True
    return any(n.startswith(p) for p in _READ_ONLY_TOOL_PREFIXES)


def identity_with_live_scopes(
    identity: AgentIdentity,
    run: dict[str, Any] | None,
) -> AgentIdentity:
    """Overlay DB scopes from ``runs/poll`` onto the baked ``agent.json`` identity.

    Scope edits update Postgres immediately, but runners load identity once at boot.
    Poll already returns live scopes — apply them per run so newly granted tools
    (e.g. ``email.read``) work without waiting for a container restart / re-download.
    """
    from dataclasses import replace as dc_replace

    if not isinstance(run, dict):
        return identity

    def _as_tuple(value: Any, fallback: tuple[str, ...]) -> tuple[str, ...]:
        if value is None:
            return fallback
        if isinstance(value, list) and all(isinstance(s, str) for s in value):
            return tuple(s.strip() for s in value if s.strip())
        return fallback

    permission = _as_tuple(
        run.get("permissionScopes", run.get("permission_scopes")),
        identity.permission_scopes,
    )
    jit = _as_tuple(
        run.get("jitScopes", run.get("jit_scopes")),
        identity.jit_scopes,
    )
    always = _as_tuple(
        run.get("alwaysScopes", run.get("always_scopes")),
        identity.always_scopes,
    )
    if (
        permission == identity.permission_scopes
        and jit == identity.jit_scopes
        and always == identity.always_scopes
    ):
        return identity
    return dc_replace(
        identity,
        permission_scopes=permission,
        jit_scopes=jit,
        always_scopes=always,
    )


def accumulate_usage(acc: dict[str, Any], round_usage: Any) -> None:
    """Sum a round's token usage into the run accumulator, in place.

    A run is N provider calls; the run's cost is their SUM. ``dict.update`` would
    overwrite, leaving only the last round's numbers — which is what RunUsage then
    billed. Numeric fields are added; ``*_details`` sub-dicts (where providers report
    ``cached_tokens``) are summed key-wise so prompt-cache hit rates stay visible.
    """
    if not isinstance(round_usage, dict):
        return
    for key, value in round_usage.items():
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            acc[key] = (acc.get(key) or 0) + value
        elif isinstance(value, dict):
            nested = acc.setdefault(key, {})
            if not isinstance(nested, dict):
                continue
            for sub_key, sub_value in value.items():
                if isinstance(sub_value, (int, float)) and not isinstance(sub_value, bool):
                    nested[sub_key] = (nested.get(sub_key) or 0) + sub_value
        elif key not in acc:
            # Non-numeric metadata (e.g. provider name): first value wins.
            acc[key] = value


def estimate_request_tokens(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> int:
    """Rough input-token estimate for one request (~chars/4).

    Counts what is actually billed: message content, tool-call ARGUMENTS (which live
    outside ``content`` and are invisible to a naive content-only sum), and the tool
    schema array — which is re-sent on every round.
    """
    chars = 0
    for message in messages:
        content = message.get("content")
        if isinstance(content, str):
            chars += len(content)
        elif isinstance(content, list):
            # Multimodal parts: only text is cheap to estimate; images are counted
            # by the provider on pixel dimensions, not characters.
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    chars += len(part["text"])
        for call in message.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            fn = call.get("function")
            if isinstance(fn, dict):
                chars += len(str(fn.get("name") or ""))
                chars += len(str(fn.get("arguments") or ""))
    if tools:
        chars += len(json.dumps(tools))
    return chars // 4


async def _compliance_tool_hook(
    phase: str,
    *,
    http: QlixHttpClient,
    agent_id: str,
    run_id: str,
    headers: dict[str, str],
    tool: str,
    args: str,
    output: str | None = None,
) -> str | None:
    """Optional before/after_tool_call compliance hooks (QLIX_COMPLIANCE_HOOKS=1)."""
    raw = os.environ.get("QLIX_COMPLIANCE_HOOKS", "0").strip().lower()
    if raw not in ("1", "true", "yes", "on"):
        return None
    try:
        payload: dict[str, Any] = {
            "phase": phase,
            "tool": tool,
            "argsPreview": (args or "")[:2000],
            "runId": run_id,
        }
        if output is not None:
            payload["outputPreview"] = (output or "")[:2000]
        body = await http.post_json(
            f"/api/v1/agents/{agent_id}/runs/{run_id}/compliance-hook",
            payload,
            headers=headers,
        )
        if isinstance(body, dict) and body.get("block"):
            return str(body.get("reason") or "Blocked by compliance policy")
    except Exception:
        return None
    return None


# Stages that must never dump into an interactive chat TTY (shared with >>> input).
_TTY_SILENT_STAGES = frozenset(
    {
        "ping_error",
        "poll_conn_error",
        "poll_waiting_backend",
        "connectivity_retry",
    }
)


def tty_safe_notice(msg: str) -> None:
    """One-line warning that does not glue onto the current `>>>` input line.

    Writes a leading newline on stderr so background connectivity messages do not
    corrupt mid-typing input, then re-draws the prompt on stdout.
    """
    text = (msg or "").strip()
    if not text:
        return
    try:
        interactive = bool(sys.stdin.isatty() and (sys.stdout.isatty() or sys.stderr.isatty()))
    except Exception:
        interactive = False
    if interactive:
        sys.stderr.write(f"\n  ! {text}\n")
        sys.stderr.flush()
        try:
            sys.stdout.write(">>> ")
            sys.stdout.flush()
        except Exception:
            pass
    else:
        print(f"  ! {text}", file=sys.stderr, flush=True)


def default_log(prefix: str) -> LogFn:
    """Log runner stages. Quiet by default on an interactive TTY (local chat).

    Set QLIX_VERBOSE=1 for full JSON logs. Set QLIX_QUIET_LOGS=1 to force quiet.
    """

    _quiet_ok = frozenset(
        {
            "poll_start",
            "poll_waiting",
            "poll_idle",
            "local_environment_synced",
            "tool_router_plan",
            "tool_filter_debug",
            "model_resolved",
            "run_claimed",
            "connectivity_ok",
        }
    )

    def _log(stage: str, **kwargs: object) -> None:
        verbose = os.environ.get("QLIX_VERBOSE", "").strip().lower() in ("1", "true", "yes")
        force_quiet = os.environ.get("QLIX_QUIET_LOGS", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        interactive = False
        try:
            interactive = bool(sys.stderr.isatty() and sys.stdin.isatty())
        except Exception:
            pass
        quiet = force_quiet or (interactive and not verbose)

        if quiet:
            if stage == "poll_waiting":
                # Banner already said ready; stay silent.
                return
            if stage in _quiet_ok or stage in _TTY_SILENT_STAGES:
                return
            if stage == "connectivity_warning":
                # Sustained backend/rate-limit failure — one clean line, no JSON.
                tty_safe_notice(str(kwargs.get("message") or kwargs.get("error") or "Backend unreachable"))
                return
            if stage == "poll_execute_error":
                err = str(kwargs.get("error") or "unknown error")
                # Transient HTTP noise is handled by hybrid_runner before logging.
                tty_safe_notice(f"Something went wrong: {err}")
                return
            if stage.endswith("_error") or "error" in stage:
                # Never dump JSON onto the interactive input line.
                err = str(kwargs.get("error") or kwargs.get("message") or stage)
                tty_safe_notice(err)
                return
            return

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
    soft: bool = False,
) -> int:
    """Post a run event. When soft=True, transient HTTP failures are swallowed
    so telemetry never aborts an otherwise-successful local tool call.
    """
    from .exceptions import HttpError

    try:
        await http.post_json(
            f"/api/v1/agents/{agent_id}/runs/{run_id}/event",
            {"seq": seq, "type": event_type, "data": data},
            headers=headers,
        )
    except HttpError as exc:
        if soft and getattr(exc, "status_code", None) in {0, 408, 425, 429, 500, 502, 503, 504}:
            return seq
        if soft:
            return seq
        raise
    except Exception:
        if soft:
            return seq
        raise
    return seq + 1


class RunCanceledError(Exception):
    """Raised when Active Runs (or API) stops the run mid-execution."""


def _status_is_canceled(status: object) -> bool:
    return str(status or "").strip().lower() in ("canceled", "cancelled")


async def fetch_run_injections(
    http: QlixHttpClient,
    *,
    agent_id: str,
    run_id: str,
    headers: dict[str, str],
) -> tuple[list[str], str]:
    """Drain mid-run steer messages and return (messages, run_status)."""
    inj = (
        await http.get_json(
            f"/api/v1/agents/{agent_id}/runs/{run_id}/injections",
            headers=headers,
        )
        or {}
    )
    status = str(inj.get("status") or "")
    raw_msgs = inj.get("messages") or []
    messages = [str(m) for m in raw_msgs if m]
    return messages, status


async def assert_run_not_canceled(
    http: QlixHttpClient,
    *,
    agent_id: str,
    run_id: str,
    headers: dict[str, str],
) -> list[str]:
    """Raise RunCanceledError if the run was stopped from the dashboard."""
    messages, status = await fetch_run_injections(
        http, agent_id=agent_id, run_id=run_id, headers=headers
    )
    if _status_is_canceled(status):
        raise RunCanceledError("Run stopped by user")
    return messages


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


def extract_tool_sources(name: str, args: str, output: str) -> list[dict[str, str]]:
    """Source URLs (+titles) a tool drew its data from, for the activity feed.

    Covers live browsing (browser_navigate / browser_ab_open → the visited URL) and
    delegates web.research tools to the research runtime. Returns [] otherwise.
    """
    if name in ("browser_navigate", "browser_ab_open"):
        try:
            params = json.loads(args) if args and args.strip() else {}
        except (json.JSONDecodeError, TypeError):
            params = {}
        url = str(params.get("url", "")).strip() if isinstance(params, dict) else ""
        if url.startswith(("http://", "https://")):
            host = urlparse(url).netloc.lower()
            host = host[4:] if host.startswith("www.") else host
            return [{"url": url, "title": host or url}]
        return []
    if name.startswith("research_"):
        try:
            from .cloud_research_runtime import extract_research_sources

            return extract_research_sources(name, args, output)
        except Exception:  # noqa: BLE001 - sources are best-effort, never fail a run
            return []
    return []


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


def chunk_for_delta_stream(content: str, words_per_chunk: int) -> list[str]:
    """Split a finished answer into a few delta chunks instead of one per word.

    Each delta is an awaited HTTP POST, so a 400-word answer used to cost 400 serial
    round-trips *after* the answer was already complete — seconds of dead time the
    user sees as the agent hanging. Chunking keeps the progressive-reveal effect in
    the UI (the client just concatenates `text`) at a fraction of the requests.
    """
    words = content.split(" ")
    if words_per_chunk <= 1:
        return [w + " " for w in words]
    return [
        " ".join(words[i : i + words_per_chunk]) + " "
        for i in range(0, len(words), words_per_chunk)
    ]


async def stream_assistant_deltas(
    http: QlixHttpClient,
    *,
    agent_id: str,
    run_id: str,
    headers: dict[str, str],
    seq: int,
    content: str,
) -> int:
    content = sanitize_assistant_content(content)
    if not content.strip():
        content = "No response generated."
    words_per_chunk = max(1, int(os.environ.get("QLIX_DELTA_WORDS_PER_CHUNK", "25")))
    for chunk in chunk_for_delta_stream(content, words_per_chunk):
        seq = await emit_event(
            http,
            agent_id=agent_id,
            run_id=run_id,
            headers=headers,
            seq=seq,
            event_type="delta",
            data={"text": chunk},
            soft=True,
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


def format_datetime_context(
    *,
    timezone_name: str | None = None,
    granted_scopes: set[str] | None = None,
) -> str:
    """Clock context for the system prompt — relative dates and CRM COQL filters."""
    from datetime import datetime
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    tz_name = (
        timezone_name or os.environ.get("QLIX_AGENT_TIMEZONE") or "Asia/Kolkata"
    ).strip()

    def _resolve_tz(name: str):
        try:
            return ZoneInfo(name), name
        except (ZoneInfoNotFoundError, Exception):
            return None, name

    tz, resolved_name = _resolve_tz(tz_name)
    if tz is None:
        tz, resolved_name = _resolve_tz("UTC")
    if tz is None:
        # Windows without tzdata: use the OS local offset (never crash a run).
        now = datetime.now().astimezone()
        tz_name = now.tzname() or "local"
        offset = now.strftime("%z")
        offset_label = f"UTC{offset[:3]}:{offset[3:]}" if len(offset) >= 5 else "local"
    else:
        tz_name = resolved_name
        now = datetime.now(tz)
        offset = now.strftime("%z")
        offset_label = f"UTC{offset[:3]}:{offset[3:]}" if len(offset) >= 5 else "UTC"

    time_label = now.strftime("%I:%M %p").lstrip("0") or "12:00 AM"

    lines = [
        f"Current date and time: {now.strftime('%A, %B %d, %Y')}, "
        f"{time_label} ({tz_name}, {offset_label}). "
        "Use this when the user says relative dates like today, yesterday, this week, or last month.",
    ]

    scopes = granted_scopes or set()
    if any(s.startswith("crm.") for s in scopes):
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        iso_today = today_start.isoformat(timespec="seconds")
        lines.append(
            "For Zoho CRM date filters (crm_query / COQL): use Created_Time, Modified_Time, "
            "or custom date fields from crm_describe_module. Compare with ISO 8601 datetimes "
            f"including timezone offset, e.g. Created_Time >= '{iso_today}'."
        )

    return "\n".join(lines)


def describe_capabilities(granted_scopes: set[str]) -> str:
    """Natural-language capability summary — TIER A (invariant per agent).

    Derived from GRANTED SCOPES only, so it is byte-identical for every run of an
    agent and can sit inside the cached prompt prefix.

    This deliberately does NOT re-list the tools. The tool schema array already
    carries every name, description and parameter; repeating a truncated copy in
    prose cost 368-720 tokens on every round and told the model nothing new. What is
    kept is the part the tool array cannot express: that the agent must not deny a
    capability its scopes grant. Models otherwise answer capability questions from
    their training prior ("I can't browse the internet") without ever calling a tool.
    """
    phrases: list[str] = []
    if "web.research" in granted_scopes:
        phrases.append(
            "search and read public content on major platforms via structured APIs (no browser)"
        )
    for prefix, phrase in _SCOPE_CAPABILITY:
        if prefix == "web.research":
            continue
        if prefix == "web.":
            if any(
                s.startswith("web.") and s != "web.research" for s in granted_scopes
            ) and phrase not in phrases:
                phrases.append(phrase)
            continue
        if any(s.startswith(prefix) for s in granted_scopes) and phrase not in phrases:
            phrases.append(phrase)

    parts: list[str] = [
        "You have REAL, working tools and can take actions by calling them — you are "
        "not a chat-only assistant."
    ]
    if phrases:
        parts.append("You are able to " + ", ".join(phrases) + ".")
    parts.append(
        "When the user asks what you can do, or whether you can do something, answer "
        "based on these capabilities and the tools available to you. Never claim you "
        "are unable to do something your tools enable (for example, do not say you "
        "cannot browse the internet when you have web access). Prefer calling a tool "
        "to actually do the task rather than asking the user to do it themselves."
    )
    return "\n\n".join(parts)


def sanitize_assistant_content(text: str) -> str:
    """Remove model reasoning leaks before showing text to the user."""
    if not text or not isinstance(text, str):
        return ""
    t = text.strip()
    if not t:
        return ""

    # Qwen / distilled models — full or partial think blocks.
    t = re.sub(
        r"<think>.*?</think>\s*",
        "",
        t,
        flags=re.DOTALL | re.IGNORECASE,
    )
    t = re.sub(
        r"^.*?</think>\s*",
        "",
        t,
        flags=re.DOTALL | re.IGNORECASE,
    )
    # Gemini / DeepSeek style think blocks (tags built at runtime).
    think_open = "<" + "think" + ">"
    think_close = "</" + "think" + ">"
    t = re.sub(
        re.escape(think_open) + r".*?" + re.escape(think_close) + r"\s*",
        "",
        t,
        flags=re.DOTALL | re.IGNORECASE,
    )
    t = re.sub(
        r"^.*?" + re.escape(think_close) + r"\s*",
        "",
        t,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Bare "thought" prefix with no XML wrapper — common when reasoning is glued to the answer.
    if re.match(r"^thought", t, re.IGNORECASE):
        greet = re.search(
            r"\.(?:\s*)(Hello|Hi|Hey there|Hey!|Hey,|I['']m here|I can help|Sure[,!]|Of course|Good (?:morning|afternoon|evening))",
            t,
            re.IGNORECASE,
        )
        if greet:
            t = t[greet.start(1) :]
        else:
            meta = re.search(r"[.!?]\s*([A-Z].{5,})$", t, re.DOTALL)
            if meta and re.search(
                r"\b(user|model|tool|error|therefore|should respond|previous turn)\b",
                t[: meta.start()],
                re.I,
            ):
                t = meta.group(1).strip()

    # ReAct-style accidental leaks
    t = re.sub(r"^Thought:\s*.+?(?=Final Answer:|Answer:|\Z)", "", t, flags=re.DOTALL | re.IGNORECASE)
    final = re.search(r"(?:Final Answer:|Answer:)\s*(.+)$", t, flags=re.DOTALL | re.IGNORECASE)
    if final:
        t = final.group(1).strip()

    return t.strip()


def is_acknowledgement_only(prompt: str) -> bool:
    """Recognize social acknowledgements that must never mutate external systems."""
    task = prompt.rsplit("\n\n---\n\n", 1)[-1]
    task = task.split("\n\nSelected skills/tools:", 1)[0].strip().lower()
    task = re.sub(r"[\s!.,;:]+$", "", task)
    return task in {
        "thanks",
        "thank you",
        "thx",
        "good job",
        "great job",
        "nice job",
        "well done",
        "awesome",
        "great",
        "perfect",
        "cool",
        "nice",
    }


def compact_history(
    messages: list[dict[str, Any]],
    *,
    keep_tool_msgs: int,
    keep_arg_calls: int,
    clear_result_over: int,
    clear_args_over: int,
) -> None:
    """Shrink history that has outlived its usefulness, in place.

    Rewriting history invalidates the provider's prompt-prefix cache from the edit
    point onward, so this only touches entries above a size threshold: it then fires
    rarely, and when it does the per-round saving far outweighs the one-off cache
    reset. Clearing a 600-char payload would be net negative.

    Two separate windows, because the two kinds of payload go stale at different rates:

    * tool RESULTS stay useful for several rounds -> keep the last ``keep_tool_msgs``.
    * tool-call ARGUMENTS are dead one round after their result arrives (the model has
      seen both the call and its outcome) -> keep only ``keep_arg_calls``. Tying these
      together meant argument clearing never fired in a typical 4-6 round run, which is
      exactly where large generated documents (create_pdf / create_xlsx / email_send)
      sit — often the single biggest item in the context.

    Messages are never removed and tool_call_id pairing is preserved, so the
    assistant.tool_calls <-> tool result linkage stays valid.
    """
    if keep_tool_msgs >= 0:
        tool_idxs = [i for i, m in enumerate(messages) if m.get("role") == "tool"]
        for i in tool_idxs[:-keep_tool_msgs] if keep_tool_msgs else tool_idxs:
            content = messages[i].get("content")
            if (
                isinstance(content, str)
                and len(content) > clear_result_over
                and not content.startswith("[cleared:")
            ):
                messages[i]["content"] = (
                    f"[cleared: {len(content)} chars of earlier tool output removed "
                    "to save context]"
                )

    call_idxs = [
        i for i, m in enumerate(messages) if m.get("role") == "assistant" and m.get("tool_calls")
    ]
    for i in call_idxs[:-keep_arg_calls] if keep_arg_calls else call_idxs:
        for call in messages[i].get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            fn = call.get("function")
            if not isinstance(fn, dict):
                continue
            args = fn.get("arguments")
            if isinstance(args, str) and len(args) > clear_args_over:
                # Must stay valid JSON: providers parse this field.
                fn["arguments"] = json.dumps(
                    {"_cleared": f"{len(args)} chars omitted; call already executed"}
                )


def build_run_context_block(
    *,
    prompt: str,
    granted_scopes: set[str],
    guidance: str = "",
    tool_preference: str = "",
    timezone_name: str | None = None,
) -> str:
    """TIER B — everything that varies per run, prepended to the user message.

    Deliberately kept OUT of the system prompt. The system prompt plus the tool array
    form the cached prefix; anything that changes between runs of the same agent
    (the clock, intent-specific guidance, retrieved context, the task itself) must sit
    after that prefix or it invalidates the cache on every single run.

    Ordering is stable so that within one run rounds 2+ still match round 1 byte for
    byte and the cached prefix extends over this block too.
    """
    sections: list[str] = [format_datetime_context(
        timezone_name=timezone_name, granted_scopes=granted_scopes
    )]
    if tool_preference.strip():
        sections.append(tool_preference.strip())
    if guidance.strip():
        sections.append(guidance.strip())
    sections.append(f"Task:\n{prompt}")
    return "\n\n".join(sections)


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
    max_rounds: int | None = None,
    max_seconds: float | None = None,
    subagent_context: Any = None,
) -> tuple[int, str, int, int, list[str], dict[str, Any], list[dict[str, str]]]:
    """Multi-turn inference with pre-bound tool executors."""
    if is_acknowledgement_only(enriched_prompt):
        log("acknowledgement_short_circuit", agent_id=agent_id, run_id=run_id)
        return seq, "You're welcome!", 0, 0, [], {}, []

    if live_view_enabled is None:
        live_view_enabled = goal_requests_live_view(enriched_prompt)

    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": enriched_prompt})
    resolved_max_rounds = (
        int(max_rounds)
        if max_rounds is not None
        else int(os.environ.get("QLIX_CLOUD_TOOL_MAX_ROUNDS", "15"))
    )
    resolved_max_seconds = (
        float(max_seconds)
        if max_seconds is not None
        else float(os.environ.get("QLIX_CLOUD_TOOL_MAX_SECONDS", "200"))
    )
    max_rounds = resolved_max_rounds
    max_seconds = resolved_max_seconds
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
    # 8192 so a full grounded report (four-part SWOT + breakdown + sources) fits in one
    # completion; it's a cap, not a target, so short replies still cost the same.
    max_tokens = int(os.environ.get("QLIX_PROXY_MAX_TOKENS", "8192"))
    # Context engineering: keep only the most recent N tool outputs verbatim in the
    # re-sent message list; older ones are replaced with a tiny placeholder to save
    # context/cost (the full outputs are still preserved in `executed_tools`).
    keep_tool_msgs = int(os.environ.get("QLIX_PROXY_KEEP_TOOL_MSGS", "8"))
    # Size thresholds for compaction. Set high on purpose — see the comment at the
    # clearing site: rewriting history costs a prefix-cache reset, so it must only pay
    # for itself on genuinely large payloads.
    clear_result_over = int(os.environ.get("QLIX_PROXY_CLEAR_RESULT_OVER_CHARS", "8000"))
    clear_args_over = int(os.environ.get("QLIX_PROXY_CLEAR_ARGS_OVER_CHARS", "4000"))
    # Keep this many most-recent tool-call messages with arguments intact; older ones
    # get oversized arguments stripped. 1 = the model still sees the call it is
    # currently interpreting the result of.
    keep_arg_calls = int(os.environ.get("QLIX_PROXY_KEEP_ARG_CALLS", "1"))
    # Largest single request, and the sum across rounds — the latter is what the run
    # actually costs, since every round re-sends the whole array plus the tool schema.
    peak_request_tokens = 0
    estimated_input_tokens = 0
    content_out = ""
    inference_rounds = 0
    # Weak tool-callers (e.g. AI21 Jamba) sometimes run one tool then return empty
    # content with no further tool calls, abandoning a multi-step task. Nudge them
    # to either finish the remaining tool steps or give a real answer, bounded so
    # we never loop forever / burn credits.
    max_empty_nudges = int(os.environ.get("QLIX_PROXY_MAX_EMPTY_NUDGES", "2"))
    empty_nudges = 0
    force_tool_next_round = False
    # Set from round 1's response; sent back on every later round (see pinned_model).
    pinned_model: str | None = None
    exit_reason = "complete"

    for round_idx in range(max_rounds):
        inference_rounds += 1
        if time.time() > deadline:
            exit_reason = "time_budget"
            content_out = content_out or "Stopped: tool loop time budget exceeded."
            break

        try:
            steer_msgs = await assert_run_not_canceled(
                http, agent_id=agent_id, run_id=run_id, headers=headers
            )
            for msg in steer_msgs:
                messages.append({"role": "user", "content": f"[User guidance]: {msg}"})
        except RunCanceledError:
            log("run_canceled", agent_id=agent_id, run_id=run_id, round=round_idx + 1)
            raise

        round_tokens = estimate_request_tokens(messages, tools)
        if round_tokens > peak_request_tokens:
            peak_request_tokens = round_tokens
        estimated_input_tokens += round_tokens

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
            pinned_model=pinned_model,
        )
        if force_tool_next_round:
            force_tool_next_round = False
        # Lock the run to whatever concrete model round 1 resolved to, so later rounds
        # keep the same provider (and therefore the same warm prompt-prefix cache).
        if pinned_model is None and proxy_result.routed_model:
            pinned_model = proxy_result.routed_model
            log("model_pinned", agent_id=agent_id, run_id=run_id, model=pinned_model)
        accumulate_usage(usage_acc, proxy_result.usage)

        # Stop may land during a long inference call — bail before executing tools.
        try:
            await assert_run_not_canceled(
                http, agent_id=agent_id, run_id=run_id, headers=headers
            )
        except RunCanceledError:
            log("run_canceled", agent_id=agent_id, run_id=run_id, phase="post_inference")
            raise

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
            tool_details: list[dict[str, object]] = []
            for tc_item in tc_list:
                if not isinstance(tc_item, dict):
                    continue
                fn_pre = tc_item.get("function") if isinstance(tc_item.get("function"), dict) else {}
                pre_name = str(fn_pre.get("name", ""))
                if not pre_name:
                    continue
                pre_args_raw = str(fn_pre.get("arguments", "") or "")
                try:
                    pre_params = json.loads(pre_args_raw) if pre_args_raw.strip() else {}
                except json.JSONDecodeError:
                    pre_params = {}
                if not isinstance(pre_params, dict):
                    pre_params = {}
                detail: dict[str, object] = {"name": pre_name}
                if is_browser_tool(pre_name) or pre_name.startswith("browser_"):
                    detail["label"] = browser_action_label(pre_name, pre_params)
                    detail["tool_args"] = sanitize_tool_args_for_ui(pre_params)
                tool_details.append(detail)
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
                    "tool_details": tool_details,
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
                blocked = await _compliance_tool_hook(
                    "before_tool_call",
                    http=http,
                    agent_id=agent_id,
                    run_id=run_id,
                    headers=headers,
                    tool=name,
                    args=args,
                )
                if blocked:
                    return {
                        "tid": tid,
                        "name": name,
                        "args": args,
                        "output": f"[failed] compliance_blocked: {blocked}",
                    }
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
                await _compliance_tool_hook(
                    "after_tool_call",
                    http=http,
                    agent_id=agent_id,
                    run_id=run_id,
                    headers=headers,
                    tool=name,
                    args=args,
                    output=str(tool_out),
                )
                return {"tid": tid, "name": name, "args": args, "output": tool_out}

            for tc_item in tc_list:
                if not isinstance(tc_item, dict):
                    continue
                fn_pre = tc_item.get("function") if isinstance(tc_item.get("function"), dict) else {}
                pre_name = str(fn_pre.get("name", ""))
                if pre_name:
                    pre_args_raw = str(fn_pre.get("arguments", "") or "")
                    try:
                        pre_params = json.loads(pre_args_raw) if pre_args_raw.strip() else {}
                    except json.JSONDecodeError:
                        pre_params = {}
                    if not isinstance(pre_params, dict):
                        pre_params = {}
                    started_data: dict[str, object] = {
                        "message": "tool_started",
                        "tool": pre_name,
                    }
                    if is_browser_tool(pre_name) or pre_name.startswith("browser_"):
                        started_data["label"] = browser_action_label(pre_name, pre_params)
                        started_data["tool_args"] = sanitize_tool_args_for_ui(pre_params)
                    if pre_name == "gui_control" or pre_name.startswith("luna_local_"):
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

            # Parallelize only read-only tools; keep mutating tools sequential.
            tool_results: list[dict[str, Any] | None] = []
            pending_readonly: list[Any] = []
            for tc in tc_list:
                if not isinstance(tc, dict):
                    continue
                fn_chk = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                tname = str(fn_chk.get("name", ""))
                if is_read_only_tool(tname):
                    pending_readonly.append(tc)
                else:
                    if pending_readonly:
                        tool_results.extend(
                            await asyncio.gather(
                                *[_execute_single_tool(x) for x in pending_readonly],
                                return_exceptions=False,
                            )
                        )
                        pending_readonly = []
                    tool_results.append(await _execute_single_tool(tc))
            if pending_readonly:
                tool_results.extend(
                    await asyncio.gather(
                        *[_execute_single_tool(x) for x in pending_readonly],
                        return_exceptions=False,
                    )
                )

            for result in tool_results:
                if not result:
                    continue
                tid = result["tid"]
                name = result["name"]
                args = result["args"]
                tool_out = result["output"]
                # Resolve `browser(action=...)` to its browser_ab_* id so the
                # per-tool truncation rules actually match (see truncation_key).
                tool_out_truncated, _ = smart_truncate_tool_result(
                    truncation_key(name, args), tool_out
                )
                tool_names_ran.append(name)
                # Keep the full (untruncated) output so callers can extract paths.
                executed_tools.append(
                    {"name": name, "args": args, "output": str(tool_out)}
                )
                sig = f"{name}\x00{args}"
                executed_call_counts[sig] = executed_call_counts.get(sig, 0) + 1
                messages.append({"role": "tool", "tool_call_id": tid, "content": tool_out_truncated})
                # Surface tool failures to the UI: executors prefix failed results
                # with "[failed] ". Research tools may return JSON blocked payloads.
                tool_failed = isinstance(tool_out, str) and tool_out.startswith("[failed] ")
                tool_error: str | None = None
                patch_summary: str | None = None
                if tool_failed:
                    tool_error = tool_out[len("[failed] ") :].strip()[:500]
                elif isinstance(tool_out, str) and name.startswith("research_"):
                    try:
                        from .cloud_research_runtime import parse_research_tool_result

                        research_ok, research_err = parse_research_tool_result(tool_out)
                        if not research_ok:
                            tool_failed = True
                            tool_error = research_err
                    except Exception:
                        pass
                elif isinstance(tool_out, str) and name == "luna_local_patch":
                    try:
                        parsed_out = json.loads(tool_out)
                    except (json.JSONDecodeError, TypeError):
                        parsed_out = None
                    if isinstance(parsed_out, dict):
                        if parsed_out.get("ok") is False:
                            tool_failed = True
                            tool_error = str(parsed_out.get("error") or "patch failed")[:500]
                        else:
                            parts = []
                            for key, label in (
                                ("files_created", "created"),
                                ("files_modified", "modified"),
                                ("files_deleted", "deleted"),
                                ("files_moved", "moved"),
                            ):
                                arr = parsed_out.get(key)
                                if isinstance(arr, list) and arr:
                                    parts.append(f"{len(arr)} {label}")
                            if parts:
                                patch_summary = ", ".join(parts)
                            elif parsed_out.get("mode") == "replace" and parsed_out.get("replacements"):
                                patch_summary = f"{parsed_out.get('replacements')} replacement(s)"
                finished_data: dict[str, object] = {
                    "message": "tool_finished",
                    "tool": name,
                    "ok": not tool_failed,
                }
                if tool_failed and tool_error:
                    finished_data["error"] = tool_error
                if patch_summary:
                    finished_data["patchSummary"] = patch_summary
                if not tool_failed:
                    sources = extract_tool_sources(name, args, str(tool_out))
                    if sources:
                        finished_data["sources"] = sources
                try:
                    finish_params = json.loads(args) if args.strip() else {}
                except json.JSONDecodeError:
                    finish_params = {}
                if not isinstance(finish_params, dict):
                    finish_params = {}
                if is_browser_tool(name) or name.startswith("browser_"):
                    finished_data["label"] = browser_action_label(name, finish_params)
                    finished_data["tool_args"] = sanitize_tool_args_for_ui(finish_params)
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
            # Lead generation / enrichment tool-order nudges.
            try:
                from .tool_router import (
                    is_lead_browser_enrichment_intent,
                    is_lead_generation_intent,
                )

                enrich_intent = is_lead_browser_enrichment_intent(enriched_prompt)
                gen_intent = is_lead_generation_intent(enriched_prompt)
            except Exception:
                enrich_intent = False
                gen_intent = False
            gmb_called = any(
                n.endswith("gmb_search_leads") or n == "gmb_search_leads" for n in tool_names_ran
            )
            premature_lead_tools = any(
                n.endswith(t) or n == t
                for n in tool_names_ran
                for t in ("start_outreach", "get_campaign", "list_leads")
            )
            if gen_intent and not gmb_called and premature_lead_tools:
                force_tool_next_round = True
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "No campaign exists yet. Call gmb_search_leads FIRST with searchQuery, "
                            "location, and maxResults from the user's request. Do not call "
                            "start_outreach or get_campaign until gmb_search_leads returns campaignId."
                        ),
                    }
                )
            # If the model is looping on think/done for lead generation, force a real scrape tool call.
            only_meta_tools = set(tool_names_ran).issubset({"think", "done"})
            has_gmb_tool = any(k.endswith("gmb_search_leads") for k in tool_executors.keys())
            if gen_intent and not gmb_called and not premature_lead_tools and only_meta_tools and has_gmb_tool:
                force_tool_next_round = True
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Call gmb_search_leads NOW to generate the leads. Use business type and location "
                            "from the user request (e.g. salons in Bangalore) and maxResults=5. "
                            "Return the campaignId."
                        ),
                    }
                )

            browser_called = any(
                n in ("browser_ab_open", "browser_navigate")
                or n.startswith("browser_ab_")
                for n in tool_names_ran
            )
            if (
                enrich_intent
                and gmb_called
                and not browser_called
                and "browser_ab_open" in tool_executors
            ):
                force_tool_next_round = True
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Stop calling gmb_search_leads — leads are already scraped. "
                            "Call list_leads with includeAll=true, then browser_ab_open on each "
                            "website in needsBrowserEnrichment, then update_lead_email or "
                            "record_lead_enrichment. Continue until every website lead is enriched."
                        ),
                    }
                )

            # After reading a source file for a PDF task, force the next model turn to
            # call a tool (usually luna_local_create_pdf) instead of returning empty text.
            if (
                "luna_local_read_file" in tool_names_ran
                and "luna_local_create_pdf" not in tool_names_ran
                and "luna_local_create_pdf" in tool_executors
                and wants_pdf_output(enriched_prompt)
            ):
                force_tool_next_round = True
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "The source file is loaded above. Call luna_local_create_pdf now with "
                            "a title and the file content as the PDF body. Do not stop after "
                            "reading — create the PDF in this run."
                        ),
                    }
                )

            compact_history(
                messages,
                keep_tool_msgs=keep_tool_msgs,
                keep_arg_calls=keep_arg_calls,
                clear_result_over=clear_result_over,
                clear_args_over=clear_args_over,
            )
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
                        "tools now (for example create the document with luna_local_create_pdf, "
                        "then deliver it with luna_local_send_whatsapp_document). Once everything "
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
    else:
        # Exhausted max_rounds without a natural completion break.
        exit_reason = "round_budget"
        if not str(content_out or "").strip():
            content_out = "Stopped: tool loop round budget exceeded."

    if exit_reason in ("time_budget", "round_budget") and subagent_context is not None:
        seq = await emit_event(
            http,
            agent_id=agent_id,
            run_id=run_id,
            headers=headers,
            seq=seq,
            event_type="log",
            data={
                "message": "budget_subagent_continue",
                "reason": exit_reason,
                "rounds": inference_rounds,
                "toolsExecuted": len(tool_names_ran),
            },
            soft=True,
        )
        try:
            from .subagents import continue_via_subagent_on_budget

            continued = await continue_via_subagent_on_budget(
                subagent_context,
                original_prompt=enriched_prompt,
                tool_names_ran=tool_names_ran,
                executed_tools=executed_tools,
                reason=exit_reason,
                log=log,
            )
            if continued and str(continued).strip():
                content_out = str(continued).strip()
                tool_names_ran.append("budget_continue_subagent")
                executed_tools.append(
                    {
                        "name": "budget_continue_subagent",
                        "args": json.dumps({"reason": exit_reason}),
                        "output": content_out[:2000],
                    }
                )
                exit_reason = "continued_via_subagent"
        except Exception as exc:  # noqa: BLE001
            log(
                "budget_subagent_continue_failed",
                agent_id=agent_id,
                run_id=run_id,
                error=str(exc)[:300],
            )

    duration_ms = int((time.time() - started) * 1000)
    log(
        "proxy_tool_loop_done",
        agent_id=agent_id,
        run_id=run_id,
        inference_rounds=inference_rounds,
        tools_executed=tool_names_ran,
        duration_ms=duration_ms,
        exit_reason=exit_reason,
    )
    # Context budget awareness. `peakRequestTokens` is the largest single request;
    # `estimatedInputTokens` sums every round, which is what the run is billed for.
    # `cachedPromptTokens` is the provider-reported prefix-cache hit — when prompt
    # caching is working this approaches the fixed (system + tools) overhead.
    prompt_details = usage_acc.get("prompt_tokens_details")
    cached_prompt_tokens = 0
    if isinstance(prompt_details, dict):
        cached_prompt_tokens = int(prompt_details.get("cached_tokens") or 0)
    seq = await emit_event(
        http,
        agent_id=agent_id,
        run_id=run_id,
        headers=headers,
        seq=seq,
        event_type="log",
        data={
            "message": "context_size",
            "peakRequestTokens": peak_request_tokens,
            "estimatedInputTokens": estimated_input_tokens,
            "reportedPromptTokens": int(usage_acc.get("prompt_tokens") or 0),
            "cachedPromptTokens": cached_prompt_tokens,
            "toolsSchemaTokens": tools_schema_bytes // 4,
            "rounds": inference_rounds,
        },
        soft=True,
    )
    content_out = sanitize_assistant_content(content_out)
    return seq, content_out, duration_ms, inference_rounds, tool_names_ran, usage_acc, executed_tools
