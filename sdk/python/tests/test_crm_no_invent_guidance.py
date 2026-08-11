"""CRM guidance must not invent writes when the user never asked."""

from __future__ import annotations

from qlix.tool_router import (
    crm_jit_run_guidance,
    crm_no_invent_guidance,
    is_crm_mutation_intent,
)


def test_is_crm_mutation_intent_positive() -> None:
    assert is_crm_mutation_intent("Create a lead for Aarav in Zoho CRM")
    assert is_crm_mutation_intent("Add a contact with this phone number")


def test_is_crm_mutation_intent_negative_for_filter_pipeline() -> None:
    prompt = (
        "filter out the leads who are in bangalore, send a whatsapp message "
        'to them saying "new ai opportunities"'
    )
    assert not is_crm_mutation_intent(prompt)


def test_crm_no_invent_guidance_forbids_create() -> None:
    text = crm_no_invent_guidance().lower()
    assert "crm_create" in text
    assert "do not" in text


def test_crm_jit_guidance_only_for_explicit_writes() -> None:
    text = crm_jit_run_guidance().lower()
    assert "crm_create" in text
    assert "when the user asks" in text
