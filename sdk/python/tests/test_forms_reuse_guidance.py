"""Forms guidance must surface responderUri and avoid recreate-on-follow-up."""

from __future__ import annotations

from qlix.tool_router import (
    forms_reuse_guidance,
    is_forms_mutation_intent,
    tool_preference_text,
)


def test_is_forms_mutation_intent_positive() -> None:
    assert is_forms_mutation_intent("make a google form for a survey")
    assert is_forms_mutation_intent("Create a form with 5 questions")


def test_is_forms_mutation_intent_negative_for_link_followup() -> None:
    assert not is_forms_mutation_intent("can u give me a shareable link")
    assert not is_forms_mutation_intent("thanks")


def test_forms_reuse_guidance_mentions_responder_uri() -> None:
    text = forms_reuse_guidance().lower()
    assert "responderuri" in text
    assert "do not create" in text or "don't create" in text


def test_empty_intent_prefers_direct_reply() -> None:
    text = tool_preference_text((), ("comms", "always"), read_only=False).lower()
    assert "reply directly" in text
    assert "do not invent" in text
