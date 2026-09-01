"""Token accounting and history compaction for the agent tool loop."""

from __future__ import annotations

import json

from qlix.runner_common import (
    accumulate_usage,
    chunk_for_delta_stream,
    compact_history,
    estimate_request_tokens,
)


def test_usage_is_summed_across_rounds_not_overwritten() -> None:
    """A run is N provider calls; its cost is their sum.

    dict.update() left only the last round's numbers, so RunUsage billed a fraction
    of a multi-round run.
    """
    acc: dict = {}
    accumulate_usage(acc, {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110})
    accumulate_usage(acc, {"prompt_tokens": 400, "completion_tokens": 20, "total_tokens": 420})
    accumulate_usage(acc, {"prompt_tokens": 900, "completion_tokens": 30, "total_tokens": 930})
    assert acc["prompt_tokens"] == 1400
    assert acc["completion_tokens"] == 60
    assert acc["total_tokens"] == 1460


def test_usage_sums_nested_cached_token_details() -> None:
    acc: dict = {}
    accumulate_usage(acc, {"prompt_tokens_details": {"cached_tokens": 0}})
    accumulate_usage(acc, {"prompt_tokens_details": {"cached_tokens": 3703}})
    assert acc["prompt_tokens_details"]["cached_tokens"] == 3703


def test_usage_ignores_non_numeric_and_keeps_first_metadata() -> None:
    acc: dict = {}
    accumulate_usage(acc, {"provider": "openai", "prompt_tokens": 5})
    accumulate_usage(acc, {"provider": "google", "prompt_tokens": 5})
    assert acc["provider"] == "openai"
    assert acc["prompt_tokens"] == 10
    accumulate_usage(acc, None)  # must not raise
    accumulate_usage(acc, "nonsense")  # must not raise


def test_estimate_counts_tool_call_arguments_and_schema() -> None:
    """The old metric summed only `content`, so tool-call args were invisible."""
    messages = [
        {"role": "system", "content": "x" * 400},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [{"function": {"name": "f", "arguments": "y" * 800}}],
        },
    ]
    content_only = sum(len(str(m.get("content") or "")) for m in messages) // 4
    estimated = estimate_request_tokens(messages, [{"schema": "z" * 200}])
    assert content_only == 100
    assert estimated > content_only * 3


def test_delta_chunking_reduces_request_count_and_preserves_text() -> None:
    content = " ".join(f"w{i}" for i in range(120))
    chunks = chunk_for_delta_stream(content, 25)
    assert len(chunks) == 5
    assert "".join(chunks).split() == content.split()


def test_compaction_clears_large_results_but_keeps_recent() -> None:
    messages = [{"role": "tool", "content": "R" * 20_000} for _ in range(3)]
    compact_history(
        messages, keep_tool_msgs=1, keep_arg_calls=1, clear_result_over=8000, clear_args_over=4000
    )
    assert messages[0]["content"].startswith("[cleared:")
    assert messages[1]["content"].startswith("[cleared:")
    assert messages[2]["content"] == "R" * 20_000


def test_compaction_leaves_small_results_alone() -> None:
    """Below threshold, clearing would cost a prefix-cache reset for no real saving."""
    messages = [{"role": "tool", "content": "small"} for _ in range(5)]
    compact_history(
        messages, keep_tool_msgs=1, keep_arg_calls=1, clear_result_over=8000, clear_args_over=4000
    )
    assert all(m["content"] == "small" for m in messages)


def test_compaction_enforces_cumulative_stale_result_budget() -> None:
    """Medium results must not evade compaction by staying below a per-item limit."""
    messages = [{"role": "tool", "content": str(i) * 4_000} for i in range(6)]
    artifacts = compact_history(
        messages,
        keep_tool_msgs=2,
        keep_arg_calls=1,
        clear_result_over=8_000,
        clear_args_over=4_000,
        max_retained_tool_chars=10_000,
    )
    assert len(artifacts) == 4
    assert all(messages[i]["content"].startswith("[cleared:") for i in range(4))
    assert messages[4]["content"] == "4" * 4_000
    assert messages[5]["content"] == "5" * 4_000


def test_compaction_never_clears_protected_recent_results_for_cumulative_budget() -> None:
    messages = [{"role": "tool", "content": str(i) * 6_000} for i in range(3)]
    compact_history(
        messages,
        keep_tool_msgs=2,
        keep_arg_calls=1,
        clear_result_over=20_000,
        clear_args_over=4_000,
        max_retained_tool_chars=4_000,
    )
    assert messages[0]["content"].startswith("[cleared:")
    assert messages[1]["content"] == "1" * 6_000
    assert messages[2]["content"] == "2" * 6_000


def test_compaction_clears_stale_oversized_tool_call_arguments() -> None:
    """A generated document body must not be re-sent on every remaining round."""
    body = json.dumps({"content": "P" * 9000})
    messages = [
        {"role": "assistant", "content": None, "tool_calls": [
            {"function": {"name": "luna_local_create_pdf", "arguments": body}}]},
        {"role": "tool", "content": "written"},
        {"role": "assistant", "content": None, "tool_calls": [
            {"function": {"name": "luna_local_send_whatsapp_document", "arguments": '{"file_path":"/x"}'}}]},
        {"role": "tool", "content": "sent"},
    ]
    compact_history(
        messages, keep_tool_msgs=8, keep_arg_calls=1, clear_result_over=8000, clear_args_over=4000
    )
    cleared = messages[0]["tool_calls"][0]["function"]["arguments"]
    assert "_cleared" in cleared
    assert len(cleared) < 200
    # Still valid JSON — providers parse this field.
    assert isinstance(json.loads(cleared), dict)
    # The most recent call keeps its arguments.
    assert messages[2]["tool_calls"][0]["function"]["arguments"] == '{"file_path":"/x"}'


def test_argument_clearing_is_independent_of_result_window() -> None:
    """Regression: gating args on keep_tool_msgs meant it never fired in short runs.

    A 4-6 round run never accumulates 8 tool results, which is exactly where the big
    document payloads live.
    """
    body = json.dumps({"content": "P" * 9000})
    messages = [
        {"role": "assistant", "content": None, "tool_calls": [
            {"function": {"name": "create", "arguments": body}}]},
        {"role": "tool", "content": "ok"},
        {"role": "assistant", "content": None, "tool_calls": [
            {"function": {"name": "send", "arguments": "{}"}}]},
        {"role": "tool", "content": "ok"},
    ]
    compact_history(
        messages, keep_tool_msgs=8, keep_arg_calls=1, clear_result_over=8000, clear_args_over=4000
    )
    assert "_cleared" in messages[0]["tool_calls"][0]["function"]["arguments"]
