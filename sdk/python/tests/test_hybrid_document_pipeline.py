"""Outcome-verification tests for the hybrid document pipeline.

Covers the regression where a hybrid run created a file but never delivered it
on WhatsApp (the model dropped the send step and looped on no-op echoes).
"""

import json
from types import SimpleNamespace

import pytest

from qlix.agents3_runtime import _filter_tools, LOCAL_TOOL_IDS
from qlix.hybrid_document_pipeline import (
    extract_created_path,
    latest_created_artifact,
    verify_and_complete_outcomes,
    whatsapp_delivery_succeeded,
)

# The create tools append a next-step hint after the path; the verifier must
# recover the bare path regardless.
XLSX_OUT = (
    r"Created spreadsheet: C:\Users\yeshw\Documents\Top-10-Fintech.xlsx"
    " — If the user asked to send/deliver this file (e.g. on WhatsApp), "
    "call luna_local_send_whatsapp_document now with file_path set to the path above."
)


def test_send_tool_offered_to_file_write_only_agent():
    """A create-and-send agent has file_write (not file_read); it must still get
    the WhatsApp send tool, or it can create a file but never deliver it."""
    ident = SimpleNamespace(permission_scopes=["system.file_write"], always_scopes=[])
    offered = _filter_tools(
        LOCAL_TOOL_IDS, ident, None, instruction="create an excel and send it on whatsapp"
    )
    assert "luna_local_send_whatsapp_document" in offered
    assert "luna_local_create_xlsx" in offered


def test_send_tool_offered_to_file_read_only_agent():
    """A read-and-send agent (e.g. intake reader) has file_read only; it must
    also get the send tool — availability is file_read OR file_write."""
    ident = SimpleNamespace(permission_scopes=["system.file_read"], always_scopes=[])
    offered = _filter_tools(
        LOCAL_TOOL_IDS, ident, ["system.file_read"], instruction="read the application and send it on whatsapp"
    )
    assert "luna_local_send_whatsapp_document" in offered


def test_send_tool_denied_without_any_file_scope():
    ident = SimpleNamespace(permission_scopes=["brain.query"], always_scopes=[])
    offered = _filter_tools(LOCAL_TOOL_IDS, ident, None, instruction="send it on whatsapp")
    assert "luna_local_send_whatsapp_document" not in offered


def test_extract_created_path_strips_hint():
    assert extract_created_path(XLSX_OUT) == r"C:\Users\yeshw\Documents\Top-10-Fintech.xlsx"


def test_extract_created_path_pdf():
    out = "Created PDF: /home/u/report.pdf"
    assert extract_created_path(out) == "/home/u/report.pdf"


def test_latest_artifact_skips_failed_and_takes_most_recent():
    executed = [
        {"name": "luna_local_create_pdf", "args": "{}", "output": "Created PDF: /tmp/a.pdf"},
        {"name": "luna_local_create_xlsx", "args": "{}", "output": XLSX_OUT},
        {"name": "luna_local_create_pdf", "args": "{}", "output": "[failed] disk full"},
    ]
    assert latest_created_artifact(executed) == r"C:\Users\yeshw\Documents\Top-10-Fintech.xlsx"


def test_extract_generic_write_path():
    out = (
        "Wrote file: /home/u/data.csv — If the user asked to send/deliver this "
        "file (e.g. on WhatsApp), call luna_local_send_whatsapp_document now..."
    )
    assert extract_created_path(out) == "/home/u/data.csv"


def test_generic_write_is_deliverable_when_no_dedicated_artifact():
    executed = [
        {"name": "luna_local_write_file", "args": "{}", "output": "Wrote file: /home/u/data.csv"},
    ]
    assert latest_created_artifact(executed) == "/home/u/data.csv"


def test_dedicated_artifact_takes_precedence_over_scratch_write():
    # Model creates the real deliverable, then writes a scratch file afterwards.
    executed = [
        {"name": "luna_local_create_pdf", "args": "{}", "output": "Created PDF: /tmp/report.pdf"},
        {"name": "luna_local_write_file", "args": "{}", "output": "Wrote file: /tmp/scratch.log"},
    ]
    assert latest_created_artifact(executed) == "/tmp/report.pdf"


def _executed_create_then_echo():
    """The exact failing shape: xlsx created, then a no-op echo, no send."""
    return [
        {"name": "luna_local_create_xlsx", "args": "{}", "output": XLSX_OUT},
        {"name": "luna_local_bash", "args": '{"command":"echo path"}', "output": "path"},
    ]


@pytest.mark.asyncio
async def test_delivery_completed_when_model_skips_send():
    sent = {}

    async def fake_send(args):
        sent["args"] = json.loads(args)
        return "Sent Top-10-Fintech.xlsx to WhatsApp."

    extra, summary = await verify_and_complete_outcomes(
        prompt="top 10 fintech companies in india excel and send on whatsapp",
        executed=_executed_create_then_echo(),
        tool_executors={"luna_local_send_whatsapp_document": fake_send},
    )

    assert extra == ["luna_local_send_whatsapp_document"]
    assert sent["args"]["file_path"] == r"C:\Users\yeshw\Documents\Top-10-Fintech.xlsx"
    assert sent["args"]["file_name"] == "Top-10-Fintech.xlsx"
    assert "automatically" in summary


@pytest.mark.asyncio
async def test_no_double_send_when_already_delivered():
    async def fake_send(args):  # pragma: no cover - must not be called
        raise AssertionError("send should not be called when already delivered")

    executed = _executed_create_then_echo() + [
        {"name": "luna_local_send_whatsapp_document", "args": "{}", "output": "Sent x to WhatsApp."}
    ]
    assert whatsapp_delivery_succeeded(executed)

    extra, _ = await verify_and_complete_outcomes(
        prompt="... send on whatsapp",
        executed=executed,
        tool_executors={"luna_local_send_whatsapp_document": fake_send},
    )
    assert extra == []


@pytest.mark.asyncio
async def test_no_delivery_when_not_requested():
    async def fake_send(args):  # pragma: no cover - must not be called
        raise AssertionError("send should not be called when whatsapp not requested")

    extra, _ = await verify_and_complete_outcomes(
        prompt="make an excel of fintech companies",
        executed=_executed_create_then_echo(),
        tool_executors={"luna_local_send_whatsapp_document": fake_send},
    )
    assert extra == []


@pytest.mark.asyncio
async def test_delivery_unmet_when_no_artifact_exists():
    """WhatsApp requested but nothing was produced — nothing to send."""
    async def fake_send(args):  # pragma: no cover - must not be called
        raise AssertionError("send should not be called without an artifact")

    extra, summary = await verify_and_complete_outcomes(
        prompt="summarize this and send on whatsapp",
        executed=[{"name": "luna_local_bash", "args": "{}", "output": "ok"}],
        tool_executors={"luna_local_send_whatsapp_document": fake_send},
    )
    assert extra == []
    assert summary == ""
