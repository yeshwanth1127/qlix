"""Tests for hybrid local terminal chat helpers."""

from __future__ import annotations

import io
from contextlib import redirect_stdout

from qlix.local_chat import (
    _brand_banner,
    _extract_jit_request,
    _format_tool_event,
    _is_jit_pending_payload,
    clear_local_run,
    handle_slash_command,
    is_local_run,
    mark_local_run,
    want_interactive_chat,
)


def test_want_interactive_chat_respects_headless_flag():
    assert want_interactive_chat(headless=True) is False


def test_want_interactive_chat_respects_env(monkeypatch):
    monkeypatch.setenv("QLIX_HEADLESS", "1")
    assert want_interactive_chat() is False
    monkeypatch.setenv("QLIX_HEADLESS", "0")
    result = want_interactive_chat()
    assert result in (True, False)


def test_local_run_id_tracking():
    clear_local_run("r1")
    assert is_local_run("r1") is False
    mark_local_run("r1")
    assert is_local_run("r1") is True
    clear_local_run("r1")
    assert is_local_run("r1") is False


def test_daemon_cli_parser_has_chat_and_headless():
    from qlix.daemon_cli import build_parser

    p = build_parser()
    ns = p.parse_args(["start", "--headless"])
    assert ns.headless is True
    ns2 = p.parse_args(["chat"])
    assert ns2.command == "chat"


def test_brand_banner_contains_outline_qlix():
    buf = io.StringIO()
    with redirect_stdout(buf):
        _brand_banner(
            agent_label="demo-agent",
            backend_url="http://localhost:3001",
            active_chat="conv123456789",
        )
    out = buf.getvalue()
    assert "██████╗" in out
    assert "╭" in out and "╮" in out
    assert "╰" in out and "╯" in out
    assert "local chat · demo-agent" in out
    assert "/help" in out
    assert "JIT" in out
    assert "Active chat: conv12345678" in out

    # Every box row must share the same visible inner width (right border aligned).
    import re

    ansi = re.compile(r"\x1b\[[0-9;]*m")
    inners: list[int] = []
    for raw in out.splitlines():
        vis = ansi.sub("", raw)
        if "│" in vis:
            a, b = vis.index("│"), vis.rindex("│")
            inners.append(b - a - 1)
        elif "╭" in vis and "╮" in vis:
            inners.append(vis.index("╮") - vis.index("╭") - 1)
        elif "╰" in vis and "╯" in vis:
            inners.append(vis.index("╯") - vis.index("╰") - 1)
    assert inners and len(set(inners)) == 1, inners


def test_help_slash_lists_commands():
    import asyncio

    from qlix.identity import AgentIdentity

    identity = AgentIdentity(
        did="did:t:1",
        agent_id="a1",
        private_key_hex="0" * 64,
        public_key_hex="1" * 64,
        permission_scopes=(),
        jit_scopes=(),
        always_scopes=(),
        backend_url="http://localhost",
        llm_mode="proxy",
        raw={},
    )
    buf = io.StringIO()
    with redirect_stdout(buf):
        handled = asyncio.run(handle_slash_command(identity, "tok", "/help"))
    assert handled is True
    text = buf.getvalue()
    assert "/history" in text
    assert "/new" in text
    assert "/fork" in text
    assert "JIT" in text


def test_extract_jit_from_sse_envelope():
    payload = {
        "seq": 7,
        "data": {
            "message": "jit_approval_pending",
            "jitRequestId": "act_abc123",
            "scope": "system.file_write",
            "scopeLabel": "Write files",
            "context": "rm -rf /tmp/x",
            "channel": "dashboard",
        },
        "createdAt": "2026-08-02T00:00:00.000Z",
    }
    assert _is_jit_pending_payload(payload) is True
    jid, label = _extract_jit_request(payload)
    assert jid == "act_abc123"
    assert "Write files" in label
    assert "rm -rf" in label


def test_extract_jit_ignores_granted():
    payload = {
        "seq": 8,
        "data": {
            "message": "jit_approval_granted",
            "jitRequestId": "act_abc123",
            "scopeLabel": "Write files",
        },
    }
    assert _is_jit_pending_payload(payload) is False
    jid, _ = _extract_jit_request(payload)
    assert jid is None


def test_format_tool_started_and_round():
    started = _format_tool_event(
        {"seq": 1, "data": {"message": "tool_started", "tool": "luna_local_bash", "label": "ls -la"}}
    )
    assert started is not None
    assert "run" in started
    assert "bash" in started

    finished = _format_tool_event(
        {"seq": 2, "data": {"message": "tool_finished", "tool": "luna_local_bash", "ok": True}}
    )
    assert finished is not None
    assert "done" in finished

    round_line = _format_tool_event(
        {
            "seq": 3,
            "data": {
                "message": "inference_tool_round",
                "round": 2,
                "tools": ["luna_local_write_file", "think"],
            },
        }
    )
    assert round_line is not None
    assert "planning" in round_line
    assert "write_file" in round_line

    canceled = _format_tool_event({"seq": 4, "data": {"message": "run_canceled"}})
    assert canceled is not None
    assert "stopped" in canceled.lower() or "canceled" in canceled.lower()


def test_format_skips_pending_jit_for_inline_prompt():
    tip = _format_tool_event(
        {
            "seq": 5,
            "data": {
                "message": "jit_approval_pending",
                "jitRequestId": "x",
                "scopeLabel": "Write",
            },
        }
    )
    assert tip is None


def test_follow_run_stream_assembles_deltas_when_done_lacks_assistant():
    """Regression: garbled/empty done.assistant must not hide streamed reply text."""
    import asyncio
    import json
    from unittest.mock import MagicMock

    from qlix.local_chat import _follow_run_stream

    lines = [
        "event: delta",
        f"data: {json.dumps({'seq': 1, 'data': {'text': 'Hello '}})}",
        "",
        "event: delta",
        f"data: {json.dumps({'seq': 2, 'data': {'text': 'world'}})}",
        "",
        "event: done",
        # Simulate interleaved framing: done event with no assistant/status
        f"data: {json.dumps({'text': 'ask! '})}",
        "",
    ]

    async def fake_aiter_lines():
        for line in lines:
            yield line

    resp = MagicMock()
    resp.status_code = 200
    resp.aiter_lines = fake_aiter_lines

    class _StreamCM:
        async def __aenter__(self):
            return resp

        async def __aexit__(self, *args):
            return False

    client = MagicMock()
    client.stream = MagicMock(return_value=_StreamCM())

    http = MagicMock()
    http._base_url = "http://localhost"
    http._client = client

    async def run():
        return await _follow_run_stream(
            http, agent_id="a1", run_id="r1", headers={"Authorization": "Bearer x"}
        )

    assistant, status, err = asyncio.run(run())
    assert assistant == "Hello world"
    assert status is None
    assert err is None
