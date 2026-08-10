"""email_send mode routing guidance from user wording."""

from __future__ import annotations

from qlix.cloud_email_runtime import email_mode_routing_guidance


def test_draft_wording_prefers_draft_mode() -> None:
    text = email_mode_routing_guidance("Please draft an email to alice@example.com about pricing")
    assert "mode='draft'" in text
    assert "mode='send'" in text  # mentions not to use send


def test_send_wording_prefers_send_mode() -> None:
    text = email_mode_routing_guidance("Send an email to alice@example.com confirming the meeting")
    assert "mode='send'" in text


def test_unrelated_message_has_no_guidance() -> None:
    assert email_mode_routing_guidance("summarize the PDF") == ""


def test_delete_draft_wording() -> None:
    text = email_mode_routing_guidance("please delete the cricket draft email")
    assert "delete_draft" in text
    assert "list_drafts" in text
