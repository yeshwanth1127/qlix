from __future__ import annotations

import json
from pathlib import Path

from qlix.context_pack import (
    assemble_run_prompt,
    estimate_tokens,
    pack_allows_context_search,
    pack_has_references,
    should_prepend_brain,
)
from qlix.runner_common import brain_event_from_pack


REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE = REPO_ROOT / "contracts/context-plane/fixtures/context-pack.v1.json"


def test_shared_context_pack_fixture_assembles() -> None:
    pack = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assembled, components = assemble_run_prompt("fallback", pack, None)
    assert "Summarize the prior specialist Result" in assembled
    assert "ctx:cm123abc0000:v1:aaaaaaaaaaaa" in assembled
    assert components["intent"] == 12
    assert pack_has_references(pack)


def test_pack_assembles_inline_components_without_duplicating_memory() -> None:
    pack = {
        "contractVersion": "qlix.context-pack.v1",
        "packId": "ctxpack_1",
        "snapshotVersion": 1,
        "inline": [
            {"component": "memory", "tokens": 4, "text": "Known fact: keep capabilities."},
            {"component": "task", "tokens": 3, "text": "Send the brochure."},
        ],
        "references": [
            {"ref": "ctx:abc1:v1:bbbbbbbbbbbb", "summary": "Prior Result"},
        ],
        "omitted": [],
        "estimatedTokens": 7,
    }
    assembled, components = assemble_run_prompt("Send the brochure.", pack, "this must not be prepended")
    assert "Known fact: keep capabilities." in assembled
    assert "Send the brochure." in assembled
    assert "this must not be prepended" not in assembled
    assert "ctx:abc1:v1:bbbbbbbbbbbb" in assembled
    assert components["memory"] == 4
    assert components["task"] == 3
    assert pack_has_references(pack)


def test_legacy_memory_prepend_when_pack_is_absent() -> None:
    assembled, components = assemble_run_prompt("Do the task", None, "Earlier conversation: hello")
    assert assembled.startswith("Earlier conversation: hello")
    assert assembled.endswith("Do the task")
    assert components["memory"] == estimate_tokens("Earlier conversation: hello")
    assert components["task"] == estimate_tokens("Do the task")


def test_previous_slice_runner_still_fetches_brain_when_pack_omits_it() -> None:
    """Product contract: until Brain is in the Resolver, useBrain still prepends."""
    pack = {
        "contractVersion": "qlix.context-pack.v1",
        "packId": "ctxpack_1",
        "snapshotVersion": 1,
        "inline": [{"component": "task", "tokens": 2, "text": "Hello"}],
        "references": [],
        "omitted": [{"component": "brain", "reason": "resolver does not inline Brain; runner may prepend a scoped block"}],
        "estimatedTokens": 2,
    }
    assert should_prepend_brain(True, pack) is True
    assert should_prepend_brain(False, pack) is False


def test_resolver_owned_empty_brain_also_suppresses_prepend() -> None:
    pack = {
        "contractVersion": "qlix.context-pack.v1",
        "packId": "ctxpack_empty",
        "snapshotVersion": 1,
        "inline": [{"component": "task", "tokens": 2, "text": "Hello"}],
        "references": [],
        "omitted": [{"component": "brain", "reason": "owned_empty"}],
        "estimatedTokens": 2,
    }
    assert should_prepend_brain(True, pack) is False


def test_resolver_owned_brain_suppresses_runner_prepend() -> None:
    pack = {
        "contractVersion": "qlix.context-pack.v1",
        "packId": "ctxpack_1",
        "snapshotVersion": 1,
        "inline": [
            {"component": "brain", "tokens": 3, "text": "Org policy: cite sources."},
            {"component": "task", "tokens": 2, "text": "Hello"},
        ],
        "references": [],
        "omitted": [],
        "estimatedTokens": 5,
    }
    assembled, components = assemble_run_prompt("Hello", pack, None)
    assert "Org policy: cite sources." in assembled
    assert components["brain"] == 3
    assert should_prepend_brain(True, pack) is False


def test_brain_activity_event_is_rebuilt_from_the_pack() -> None:
    pack = {
        "inline": [
            {
                "component": "brain",
                "tokens": 4,
                "text": "Receipts over $50 need approval.",
                "data": {"citations": [{"documentTitle": "Travel policy"}]},
            }
        ]
    }
    payload = brain_event_from_pack(pack)
    assert payload is not None
    assert payload["tool"] == "brain.query"
    assert payload["fromContextPack"] is True
    assert payload["citationCount"] == 1
    assert payload["citationTitles"] == ["Travel policy"]


def test_context_search_is_offered_for_brain_or_referenced_packs() -> None:
    pack = {
        "contractVersion": "qlix.context-pack.v1",
        "packId": "ctxpack_1",
        "snapshotVersion": 1,
        "inline": [],
        "references": [{"ref": "ctx:abc1:v1:bbbbbbbbbbbb", "summary": "Prior"}],
        "omitted": [],
        "estimatedTokens": 0,
    }
    assert pack_allows_context_search(pack, False) is True
    assert pack_allows_context_search({"references": []}, True) is True
    assert pack_allows_context_search({"references": []}, False) is False
