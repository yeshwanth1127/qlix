"""Interactive local-terminal chat for hybrid runners (Claude-style TTY).

Commands: /help /history /new /fork /chats /use <id>
Inline JIT: when a tool needs approval, prompts Approve? [y/N] in this window.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
from pathlib import Path
from typing import Any

from .http_client import QlixHttpClient
from .identity import AgentIdentity

_local_run_ids: set[str] = set()
_local_run_lock = threading.Lock()

# Shared with stdin thread for JIT yes/no while a run stream is active.
_jit_reply_queue: asyncio.Queue[str] | None = None
_jit_waiting = False
_active_conversation_id: str | None = None


def mark_local_run(run_id: str) -> None:
    if not run_id:
        return
    with _local_run_lock:
        _local_run_ids.add(run_id)


def is_local_run(run_id: str) -> bool:
    with _local_run_lock:
        return run_id in _local_run_ids


def clear_local_run(run_id: str) -> None:
    with _local_run_lock:
        _local_run_ids.discard(run_id)


def want_interactive_chat(*, headless: bool | None = None) -> bool:
    if headless is None:
        env = os.environ.get("QLIX_HEADLESS", "").strip().lower()
        headless = env in ("1", "true", "yes", "on")
    if headless:
        return False
    try:
        return bool(sys.stdin.isatty() and sys.stdout.isatty())
    except Exception:
        return False


def _print(msg: str) -> None:
    print(msg, flush=True)


def _print_err(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _print_assistant(text: str) -> None:
    """Print LLM/assistant reply with a `> ` prefix on each line."""
    lines = (text or "").splitlines() or [""]
    for line in lines:
        _print(f"> {line}")


def _input_prompt() -> None:
    """Write the classic Python-style input prompt (`>>> `)."""
    sys.stdout.write(">>> ")
    sys.stdout.flush()


def _brand_banner(*, agent_label: str, backend_url: str, active_chat: str | None) -> None:
    """Print a clear QLIX. brand banner (TTY stand-in for Londrina Outline)."""
    use_color = False
    try:
        use_color = bool(sys.stdout.isatty()) and os.environ.get("NO_COLOR") is None
    except Exception:
        pass
    # Brand accent ≈ #f97316
    orange = "\033[38;5;208m" if use_color else ""
    dim = "\033[2m" if use_color else ""
    reset = "\033[0m" if use_color else ""
    period = f"{orange}.{reset}"

    # Inner width between │ … │ / ╭ … ╮ (must match on every row).
    inner_w = 46
    rule = "─" * inner_w

    def _vlen(s: str) -> int:
        out = []
        i = 0
        while i < len(s):
            if s[i] == "\033":
                j = s.find("m", i)
                i = len(s) if j < 0 else j + 1
                continue
            out.append(s[i])
            i += 1
        return len(out)

    def _pad(s: str) -> str:
        n = _vlen(s)
        if n < inner_w:
            return s + (" " * (inner_w - n))
        return s

    def _row(content: str) -> str:
        return f"  {dim}│{reset}{_pad(content)}{dim}│{reset}"

    sub = f"local chat · {agent_label}"
    if len(sub) > 42:
        sub = sub[:39] + "…"
    back = backend_url
    if len(back) > 42:
        back = back[:39] + "…"

    # Unambiguous block letters — previous outline glyph was misread as "LUCY".
    lines = [
        "",
        f"  {dim}╭{rule}╮{reset}",
        _row(""),
        _row("    ██████╗ ██╗     ██╗██╗  ██╗"),
        _row("   ██╔═══██╗██║     ██║╚██╗██╔╝"),
        _row("   ██║   ██║██║     ██║ ╚███╔╝"),
        _row("   ██║▄▄ ██║██║     ██║ ██╔██╗"),
        _row(f"   ╚██████╔╝███████╗██║██╔╝ ██╗{period}"),
        _row("    ╚══▀▀═╝ ╚══════╝╚═╝╚═╝  ╚═╝"),
        _row(""),
        _row(f"   {sub}"),
        _row(f"   {back}"),
        _row("   Type at >>> · /help · JIT y/N"),
        f"  {dim}╰{rule}╯{reset}",
    ]
    for line in lines:
        _print(line)
    if active_chat:
        _print(f"  Active chat: {active_chat[:12]}…")
    _print("")


def _state_path(agent_id: str) -> Path:
    return Path.home() / ".qlix" / "local_chat" / f"{agent_id}.json"


def _load_active_conversation(agent_id: str) -> str | None:
    global _active_conversation_id
    try:
        p = _state_path(agent_id)
        if p.is_file():
            data = json.loads(p.read_text(encoding="utf-8"))
            cid = data.get("conversationId")
            if isinstance(cid, str) and cid.strip():
                _active_conversation_id = cid.strip()
                return _active_conversation_id
    except Exception:
        pass
    return _active_conversation_id


def _save_active_conversation(agent_id: str, conversation_id: str) -> None:
    global _active_conversation_id
    _active_conversation_id = conversation_id
    try:
        p = _state_path(agent_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"conversationId": conversation_id}), encoding="utf-8")
    except Exception:
        pass


def _headers(token: str) -> dict[str, str]:
    return {"X-QLIX-Runner-Token": token}


def _sse_inner(payload: dict[str, Any]) -> dict[str, Any]:
    """Unwrap SSE envelope `{ seq, data, createdAt }` → inner log payload."""
    inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    return inner if isinstance(inner, dict) else {}


def _short_tool_name(name: str) -> str:
    n = (name or "").strip()
    if n.startswith("luna_local_"):
        return n[len("luna_local_") :]
    if n.startswith("browser_ab_"):
        return "browser." + n[len("browser_ab_") :]
    if n.startswith("mcp_"):
        return n
    return n


def _format_tool_event(data: dict[str, Any]) -> str | None:
    """Human-readable live progress line (Active Runs–style, not raw JSON)."""
    if not isinstance(data, dict):
        return None
    inner = _sse_inner(data)
    if not inner:
        return None
    msg = str(inner.get("message") or "")
    if msg in (
        "jit_approval_pending",
    ) or (inner.get("jitRequestId") and msg == "jit_approval_pending"):
        return None  # prompted inline
    if msg == "jit_approval_granted":
        scope = str(inner.get("scopeLabel") or inner.get("scope") or "")
        auto = inner.get("auto") is True
        return f"  ▸ JIT {'auto-' if auto else ''}approved" + (f" · {scope}" if scope else "")
    if msg == "jit_approval_denied":
        scope = str(inner.get("scopeLabel") or inner.get("scope") or "")
        return f"  ▸ JIT denied" + (f" · {scope}" if scope else "")
    if msg == "jit_approval_expired":
        return "  ▸ JIT expired"

    verbose = os.environ.get("QLIX_VERBOSE", "").strip().lower() in ("1", "true", "yes")

    if msg == "run_canceled":
        return "  ▸ stopped (canceled from Active Runs)"
    if msg == "run_started" or msg == "hybrid_runner_start":
        return "  ▸ run started"
    if msg == "inference_request":
        model = str(inner.get("model") or "").strip()
        n = inner.get("tools_offered")
        bit = f"model {model}" if model else "calling model"
        if isinstance(n, int):
            bit += f" · {n} tools"
        return f"  ▸ {bit}"
    if msg == "inference_tool_round":
        tools = inner.get("tools") or []
        names: list[str] = []
        if isinstance(tools, list):
            names = [_short_tool_name(str(t)) for t in tools if t][:6]
        if not names:
            details = inner.get("tool_details") or []
            if isinstance(details, list):
                for d in details[:6]:
                    if isinstance(d, dict) and d.get("name"):
                        names.append(_short_tool_name(str(d["name"])))
        joined = ", ".join(names) if names else "tools"
        rnd = inner.get("round")
        prefix = f"round {rnd}: " if rnd else ""
        return f"  ▸ {prefix}planning {joined}"
    if msg == "tool_started":
        tool = _short_tool_name(str(inner.get("tool") or "tool"))
        label = str(inner.get("label") or "").strip()
        detail = label[:80] if label else ""
        line = f"  ▸ run {tool}"
        if detail and detail.lower() != tool.lower():
            line += f" — {detail}"
        return line
    if msg == "tool_finished":
        tool = _short_tool_name(str(inner.get("tool") or "tool"))
        ok = inner.get("ok")
        err = str(inner.get("error") or "").strip()
        label = str(inner.get("label") or "").strip()
        if ok is False or err:
            bit = err[:100] if err else "failed"
            return f"  ▸ fail {tool} — {bit}"
        line = f"  ▸ done {tool}"
        if label and label.lower() != tool.lower():
            line += f" — {label[:60]}"
        patch = str(inner.get("patchSummary") or "").strip()
        if patch:
            line += f" — {patch[:60]}"
        return line
    if msg == "agents3_step":
        tool = _short_tool_name(str(inner.get("tool") or ""))
        phase = str(inner.get("phase") or "").strip()
        detail = str(inner.get("detail") or "")[:80]
        verb = phase or "step"
        line = f"  ▸ {verb}"
        if tool:
            line += f" {tool}"
        if detail:
            line += f" — {detail}"
        return line
    if msg == "empty_response_nudge":
        return "  ▸ nudging model to continue…"
    if msg == "tool_loop_stuck_break":
        return "  ▸ tool loop stuck — stopping repeats"
    if msg == "context_size" and verbose:
        return f"  ▸ context ~{inner.get('approxTokens')} tokens"
    if msg == "browser_frame" or msg == "gui_frame":
        return None  # noisy for TTY
    if msg == "run_result":
        return None  # final reply follows
    if msg.startswith("inference_") and verbose:
        return f"  ▸ {msg.replace('_', ' ')}"

    tool = str(inner.get("tool") or "")
    if tool:
        phase = str(inner.get("phase") or "")
        detail = str(inner.get("detail") or "")[:80]
        verb = "tool"
        if msg == "tool_finished" or phase == "done":
            verb = "done"
        elif phase == "execute" or msg == "agents3_step":
            verb = "run"
        elif msg == "tool_started":
            verb = "run"
        line = f"  ▸ {verb} {_short_tool_name(tool)}"
        if detail:
            line += f" — {detail}"
        return line
    return None


def _extract_jit_request(payload: dict[str, Any]) -> tuple[str | None, str]:
    """Return (jitRequestId, scopeLabel) from an SSE payload for a *pending* request."""
    inner = _sse_inner(payload) if isinstance(payload, dict) else {}
    if not inner:
        return None, ""
    msg = str(inner.get("message") or "")
    if msg in ("jit_approval_granted", "jit_approval_denied", "jit_approval_expired"):
        return None, ""
    jid = inner.get("jitRequestId") or inner.get("jit_request_id")
    if not isinstance(jid, str) or not jid.strip():
        return None, ""
    label = str(inner.get("scopeLabel") or inner.get("scope") or "action").strip()
    context = str(inner.get("context") or "").strip()
    if context:
        label = f"{label} — {context[:100]}"
    return jid.strip(), label


def _is_jit_pending_payload(payload: dict[str, Any]) -> bool:
    inner = _sse_inner(payload)
    msg = str(inner.get("message") or "")
    if msg == "jit_approval_pending":
        return True
    if msg in ("jit_approval_granted", "jit_approval_denied", "jit_approval_expired"):
        return False
    jid = inner.get("jitRequestId") or inner.get("jit_request_id")
    return isinstance(jid, str) and bool(jid.strip())


async def _decide_jit(
    *,
    agent_id: str,
    headers: dict[str, str],
    backend_url: str,
    jit_request_id: str,
    approved: bool,
) -> bool:
    """Decide via a fresh client so we never block the open SSE stream client."""
    try:
        async with QlixHttpClient(base_url=backend_url, timeout_s=30.0) as http:
            result = await http.post_json(
                f"/api/v1/agents/{agent_id}/runner/jit/decide",
                {"jitRequestId": jit_request_id, "approved": approved},
                headers=headers,
            )
        status = str(result.get("status") or "")
        _print(f"  → JIT {status}")
        return status == "approved"
    except Exception as exc:
        _print_err(f"  [jit decide failed] {exc}")
        return False


async def _prompt_jit_inline(
    *,
    agent_id: str,
    headers: dict[str, str],
    backend_url: str,
    jit_request_id: str,
    label: str,
) -> None:
    global _jit_waiting
    _print("")
    _print(f"  ── JIT approval needed: {label}")
    _print("  Approve? [y/N]  (yes / y · deny / n / d)")
    sys.stdout.write("JIT › ")
    sys.stdout.flush()

    q = _jit_reply_queue
    _jit_waiting = True
    try:
        if q is None:
            _print_err("  [jit] no reply queue — deny")
            await _decide_jit(
                agent_id=agent_id,
                headers=headers,
                backend_url=backend_url,
                jit_request_id=jit_request_id,
                approved=False,
            )
            return
        try:
            reply = await asyncio.wait_for(q.get(), timeout=280.0)
        except asyncio.TimeoutError:
            _print("  (JIT timed out — denying)")
            await _decide_jit(
                agent_id=agent_id,
                headers=headers,
                backend_url=backend_url,
                jit_request_id=jit_request_id,
                approved=False,
            )
            return
        except asyncio.CancelledError:
            _print("  (JIT prompt canceled)")
            raise
        ans = (reply or "").strip().lower()
        approved = ans in ("y", "yes", "a", "approve", "ok")
        await _decide_jit(
            agent_id=agent_id,
            headers=headers,
            backend_url=backend_url,
            jit_request_id=jit_request_id,
            approved=approved,
        )
    finally:
        _jit_waiting = False


async def _follow_run_stream(
    http: QlixHttpClient,
    *,
    agent_id: str,
    run_id: str,
    headers: dict[str, str],
) -> tuple[str | None, str | None, str | None]:
    """Follow run SSE. Returns (assistant_text, done_status, done_error).

    JIT prompts run as concurrent tasks so the SSE reader keeps draining events
    (tools + cancel) instead of blocking until the user answers.
    """
    path = f"/api/v1/agents/{agent_id}/runner/runs/{run_id}/stream"
    assistant: str | None = None
    done_status: str | None = None
    done_error: str | None = None
    delta_parts: list[str] = []
    url = f"{http._base_url}{path}"  # noqa: SLF001
    backend_url = http._base_url  # noqa: SLF001
    seen_jit: set[str] = set()
    jit_tasks: list[asyncio.Task[None]] = []

    def _spawn_jit(jid: str, label: str) -> None:
        if jid in seen_jit:
            return
        seen_jit.add(jid)
        jit_tasks.append(
            asyncio.create_task(
                _prompt_jit_inline(
                    agent_id=agent_id,
                    headers=headers,
                    backend_url=backend_url,
                    jit_request_id=jid,
                    label=label or "action",
                )
            )
        )

    try:
        async with http._client.stream(  # noqa: SLF001
            "GET",
            url,
            headers={**headers, "Accept": "text/event-stream"},
            timeout=600.0,
        ) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                _print_err(f"  [stream error {resp.status_code}] {body[:200]!r}")
                return None, None, f"stream HTTP {resp.status_code}"
            event_name = "message"
            async for line in resp.aiter_lines():
                if not line:
                    # SSE: blank line dispatches the event and resets the type.
                    event_name = "message"
                    continue
                if line.startswith("event:"):
                    event_name = line[6:].strip() or "message"
                    continue
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                if event_name == "done":
                    if isinstance(payload, dict):
                        text = payload.get("assistant")
                        if isinstance(text, str) and text.strip():
                            assistant = text.strip()
                        st = payload.get("status")
                        if isinstance(st, str) and st.strip():
                            done_status = st.strip()
                        err = payload.get("error")
                        if isinstance(err, str) and err.strip():
                            done_error = err.strip()
                        elif isinstance(err, dict):
                            msg = err.get("message") or err.get("code")
                            if isinstance(msg, str) and msg.strip():
                                done_error = msg.strip()
                    break

                if event_name == "delta" and isinstance(payload, dict):
                    # Deltas are {seq, data: {text}, ...} or bare {text}.
                    inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload
                    piece = inner.get("text") if isinstance(inner, dict) else None
                    if isinstance(piece, str) and piece:
                        delta_parts.append(piece)
                    continue

                if isinstance(payload, dict) and _is_jit_pending_payload(payload):
                    jid, label = _extract_jit_request(payload)
                    if jid:
                        _spawn_jit(jid, label)
                        continue

                tip = _format_tool_event(payload if isinstance(payload, dict) else {})
                if tip:
                    _print(tip)
    except Exception as exc:
        _print_err(f"  [stream] {exc}")
        for t in jit_tasks:
            t.cancel()
        # Prefer whatever text we already assembled from deltas.
        if not assistant and delta_parts:
            assistant = "".join(delta_parts).strip() or None
        return assistant, done_status, str(exc)
    finally:
        # If the run ended (incl. cancel), drop open JIT prompts so we return to >>> .
        if done_status in ("canceled", "cancelled", "failed", "timeout"):
            for t in jit_tasks:
                if not t.done():
                    t.cancel()
        if jit_tasks:
            await asyncio.gather(*jit_tasks, return_exceptions=True)

    if not assistant and delta_parts:
        assistant = "".join(delta_parts).strip() or None
    return assistant, done_status, done_error


async def send_local_message_and_wait(
    identity: AgentIdentity,
    runner_token: str,
    message: str,
    *,
    conversation_id: str | None = None,
) -> str | None:
    """Send a message; returns conversationId used."""
    headers = _headers(runner_token)
    body: dict[str, Any] = {"message": message}
    cid = conversation_id or _active_conversation_id
    if cid:
        body["conversationId"] = cid

    async with QlixHttpClient(base_url=identity.backend_url, timeout_s=60.0) as http:
        try:
            result = await http.post_json(
                f"/api/v1/agents/{identity.agent_id}/runner/local-message",
                body,
                headers=headers,
            )
        except Exception as exc:
            _print_err(f"  [failed to send] {exc}")
            return cid

        used_cid = str(result.get("conversationId") or cid or "")
        if used_cid:
            _save_active_conversation(identity.agent_id, used_cid)

        run_id = str(result.get("runId") or "")
        status = str(result.get("status") or "")
        if status == "steered":
            _print("  (steered active run)")
            return used_cid
        if not run_id:
            _print_err(f"  [failed] unexpected response: {result}")
            return used_cid

        mark_local_run(run_id)
        _print(f"  … running ({run_id[:8]}…)  chat={used_cid[:8]}…")
        try:
            reply, done_status, done_error = await _follow_run_stream(
                http,
                agent_id=identity.agent_id,
                run_id=run_id,
                headers=headers,
            )
            _print("")
            if done_status in ("canceled", "cancelled"):
                _print("  (run stopped)")
            elif reply:
                _print_assistant(reply)
            elif done_error:
                _print_assistant(f"(run failed: {done_error})")
            elif done_status in ("failed", "timeout"):
                _print_assistant(f"(run {done_status} — try again)")
            elif done_status == "success":
                _print_assistant("(completed — no text reply)")
            else:
                _print_assistant("(no reply — run may have failed; try again)")
        finally:
            clear_local_run(run_id)
        return used_cid


async def _cmd_help() -> None:
    _print(
        """
Commands:
  /help              Show this help
  /history [n]       Show last n messages (default 30)
  /chats             List conversations
  /new [title]       Start a new local chat thread
  /fork [title]      Fork the current chat (copy history)
  /use <id>          Switch to a conversation by id (prefix ok)
  /clear-screen      Clear the terminal (does not delete history)

Chat normally by typing without a leading /.
JIT approvals appear as: JIT › y/N
""".strip()
    )


async def _cmd_history(
    identity: AgentIdentity, token: str, args: str
) -> None:
    n = 30
    if args.strip().isdigit():
        n = max(1, min(200, int(args.strip())))
    cid = _active_conversation_id or _load_active_conversation(identity.agent_id)
    headers = _headers(token)
    async with QlixHttpClient(base_url=identity.backend_url, timeout_s=30.0) as http:
        if not cid:
            # bootstrap: send empty list via conversations
            data = await http.get_json(
                f"/api/v1/agents/{identity.agent_id}/runner/conversations",
                headers=headers,
            )
            convos = data.get("conversations") or []
            if not convos:
                _print("  (no messages yet)")
                return
            cid = str(convos[0]["id"])
            _save_active_conversation(identity.agent_id, cid)
        data = await http.get_json(
            f"/api/v1/agents/{identity.agent_id}/runner/conversations/{cid}/messages?limit={n}",
            headers=headers,
        )
        title = (data.get("conversation") or {}).get("title") or cid[:8]
        msgs = data.get("messages") or []
        _print(f"  —— history · {title} ({len(msgs)} shown) ——")
        for m in msgs:
            role = str(m.get("role") or "?")
            content = str(m.get("content") or "").replace("\n", " ")
            if len(content) > 200:
                content = content[:197] + "…"
            if role == "user":
                _print(f">>> {content}")
            elif role in ("agent", "assistant"):
                _print(f"> {content}")
            else:
                _print(f"  {role}: {content}")
        _print("  —— end ——")


async def _cmd_chats(identity: AgentIdentity, token: str) -> None:
    headers = _headers(token)
    async with QlixHttpClient(base_url=identity.backend_url, timeout_s=30.0) as http:
        data = await http.get_json(
            f"/api/v1/agents/{identity.agent_id}/runner/conversations",
            headers=headers,
        )
        convos = data.get("conversations") or []
        if not convos:
            _print("  (no conversations)")
            return
        active = _active_conversation_id
        _print("  —— chats ——")
        for c in convos:
            cid = str(c.get("id") or "")
            mark = "*" if cid == active else " "
            title = c.get("title") or "(untitled)"
            kind = c.get("kind") or "chat"
            n = c.get("messageCount") or 0
            _print(f"  {mark} {cid[:10]}…  [{kind}] {title}  ({n} msgs)")
        _print("  (* = active)  Use /use <id> to switch")


async def _cmd_new(identity: AgentIdentity, token: str, args: str) -> None:
    headers = _headers(token)
    body: dict[str, Any] = {}
    if args.strip():
        body["title"] = args.strip()[:120]
    async with QlixHttpClient(base_url=identity.backend_url, timeout_s=30.0) as http:
        data = await http.post_json(
            f"/api/v1/agents/{identity.agent_id}/runner/conversations",
            body,
            headers=headers,
        )
        convo = data.get("conversation") or {}
        cid = str(convo.get("id") or "")
        title = convo.get("title") or cid
        if cid:
            _save_active_conversation(identity.agent_id, cid)
            _print(f"  New chat: {title} ({cid[:10]}…)")
        else:
            _print_err(f"  [failed] {data}")


async def _cmd_fork(identity: AgentIdentity, token: str, args: str) -> None:
    cid = _active_conversation_id or _load_active_conversation(identity.agent_id)
    if not cid:
        _print("  No active chat to fork — send a message or /new first.")
        return
    headers = _headers(token)
    body: dict[str, Any] = {}
    if args.strip():
        body["title"] = args.strip()[:120]
    async with QlixHttpClient(base_url=identity.backend_url, timeout_s=60.0) as http:
        data = await http.post_json(
            f"/api/v1/agents/{identity.agent_id}/runner/conversations/{cid}/fork",
            body,
            headers=headers,
        )
        convo = data.get("conversation") or {}
        new_id = str(convo.get("id") or "")
        title = convo.get("title") or new_id
        n = convo.get("messageCount") or 0
        if new_id:
            _save_active_conversation(identity.agent_id, new_id)
            _print(f"  Forked → {title} ({new_id[:10]}…, {n} messages copied)")
        else:
            _print_err(f"  [failed] {data}")


async def _cmd_use(identity: AgentIdentity, token: str, args: str) -> None:
    prefix = args.strip()
    if not prefix:
        _print("  Usage: /use <conversation-id-prefix>")
        return
    headers = _headers(token)
    async with QlixHttpClient(base_url=identity.backend_url, timeout_s=30.0) as http:
        data = await http.get_json(
            f"/api/v1/agents/{identity.agent_id}/runner/conversations",
            headers=headers,
        )
        matches = [
            c
            for c in (data.get("conversations") or [])
            if str(c.get("id") or "").startswith(prefix) or str(c.get("id") or "") == prefix
        ]
        if not matches:
            _print(f"  No conversation matching {prefix!r}")
            return
        if len(matches) > 1 and not any(str(c.get("id")) == prefix for c in matches):
            _print(f"  Ambiguous — {len(matches)} matches; use a longer id prefix")
            return
        chosen = next((c for c in matches if str(c.get("id")) == prefix), matches[0])
        cid = str(chosen.get("id"))
        _save_active_conversation(identity.agent_id, cid)
        _print(f"  Switched to {chosen.get('title') or cid} ({cid[:10]}…)")


async def handle_slash_command(
    identity: AgentIdentity, token: str, line: str
) -> bool:
    """Return True if line was a slash command (handled)."""
    if not line.startswith("/"):
        return False
    parts = line[1:].split(maxsplit=1)
    cmd = (parts[0] or "").lower()
    args = parts[1] if len(parts) > 1 else ""
    try:
        if cmd in ("help", "h", "?"):
            await _cmd_help()
        elif cmd in ("history", "hist"):
            await _cmd_history(identity, token, args)
        elif cmd in ("chats", "list", "ls"):
            await _cmd_chats(identity, token)
        elif cmd == "new":
            await _cmd_new(identity, token, args)
        elif cmd == "fork":
            await _cmd_fork(identity, token, args)
        elif cmd == "use":
            await _cmd_use(identity, token, args)
        elif cmd in ("clear-screen", "cls", "clear"):
            os.system("cls" if os.name == "nt" else "clear")
        else:
            _print(f"  Unknown command /{cmd} — try /help")
    except Exception as exc:
        _print_err(f"  [command failed] {exc}")
    return True


def notice_remote_run(run_id: str, prompt_preview: str = "") -> None:
    if is_local_run(run_id):
        return
    preview = (prompt_preview or "").strip().replace("\n", " ")
    if len(preview) > 60:
        preview = preview[:57] + "…"
    suffix = f": {preview}" if preview else ""
    _print(f"\n[remote] Handling message from web/WhatsApp{suffix}")
    _input_prompt()


def _stdin_loop(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue[str | None]) -> None:
    """Read stdin on a daemon thread; route JIT replies while an approval prompt is open.

    Critical: the main asyncio task is often blocked inside `_follow_run_stream` when
    JIT is pending, so it cannot drain `queue` and forward to `_jit_reply_queue`.
    Route at the source instead.
    """
    try:
        while True:
            try:
                line = input()
            except EOFError:
                loop.call_soon_threadsafe(queue.put_nowait, None)
                break

            def _route(line: str = line) -> None:
                if _jit_waiting and _jit_reply_queue is not None:
                    _jit_reply_queue.put_nowait(line)
                else:
                    queue.put_nowait(line)

            loop.call_soon_threadsafe(_route)
    except Exception:
        loop.call_soon_threadsafe(queue.put_nowait, None)


async def run_local_chat_repl(identity: AgentIdentity, runner_token: str) -> None:
    global _jit_reply_queue

    agent_label = identity.agent_id
    raw_name = identity.raw.get("name") if isinstance(identity.raw, dict) else None
    if isinstance(raw_name, str) and raw_name.strip():
        agent_label = raw_name.strip()

    _load_active_conversation(identity.agent_id)

    _brand_banner(
        agent_label=agent_label,
        backend_url=identity.backend_url,
        active_chat=_active_conversation_id,
    )

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    _jit_reply_queue = asyncio.Queue()
    threading.Thread(target=_stdin_loop, args=(loop, queue), daemon=True).start()

    busy = False
    pending: str | None = None

    _input_prompt()

    while True:
        line = await queue.get()
        if line is None:
            _print("\n[local chat] stdin closed — keeping runner online (Ctrl+C to exit).")
            await asyncio.Event().wait()
            return

        # Defensive: stdin thread normally routes JIT replies directly, but if a
        # line landed here while waiting, forward it.
        if _jit_waiting:
            if _jit_reply_queue is not None:
                await _jit_reply_queue.put(line)
            continue

        text = line.strip()
        if not text:
            _input_prompt()
            continue

        if text.startswith("/"):
            await handle_slash_command(identity, runner_token, text)
            _input_prompt()
            continue

        if busy:
            if pending is None:
                pending = text
                _print("  (busy — queued 1 message; will send after this turn)")
            else:
                _print("  (busy — queue full; wait for the current reply)")
            continue

        while True:
            busy = True
            try:
                await send_local_message_and_wait(identity, runner_token, text)
            finally:
                busy = False
            if pending is None:
                break
            text = pending
            pending = None
            _print(f">>> {text}")
        _print("")
        _input_prompt()
