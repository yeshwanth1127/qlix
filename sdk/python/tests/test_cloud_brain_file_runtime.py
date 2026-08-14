"""Tests for brain document lookup tools."""

from __future__ import annotations

from qlix.cloud_brain_file_runtime import openai_brain_file_tool_definitions
from qlix.identity import AgentIdentity


def _identity(**kwargs: object) -> AgentIdentity:
    base = {
        "did": "did:t:1",
        "agent_id": "a1",
        "private_key_hex": "0" * 64,
        "public_key_hex": "1" * 64,
        "permission_scopes": ("brain.query",),
        "jit_scopes": (),
        "always_scopes": (),
        "backend_url": "http://localhost",
        "llm_mode": "proxy",
        "raw": {},
    }
    base.update(kwargs)
    return AgentIdentity(
        did=str(base["did"]),
        agent_id=str(base["agent_id"]),
        private_key_hex=str(base["private_key_hex"]),
        public_key_hex=str(base["public_key_hex"]),
        permission_scopes=tuple(base["permission_scopes"]),  # type: ignore[arg-type]
        jit_scopes=tuple(base["jit_scopes"]),  # type: ignore[arg-type]
        always_scopes=tuple(base["always_scopes"]),  # type: ignore[arg-type]
        backend_url=str(base["backend_url"]),
        llm_mode=str(base["llm_mode"]),
        raw=dict(base["raw"]),  # type: ignore[arg-type]
    )


def test_brain_find_documents_offered_with_brain_query_scope() -> None:
    defs = openai_brain_file_tool_definitions(_identity(), None)
    names = {d["function"]["name"] for d in defs}
    assert "brain_find_documents" in names


def test_brain_find_documents_offered_when_skill_filter_is_scope() -> None:
    defs = openai_brain_file_tool_definitions(_identity(), ["brain.query", "web.read"])
    names = {d["function"]["name"] for d in defs}
    assert "brain_find_documents" in names


def test_brain_find_documents_hidden_without_scope() -> None:
    defs = openai_brain_file_tool_definitions(
        _identity(permission_scopes=("web.read",)),
        None,
    )
    assert defs == []


def test_brain_file_defs_do_not_crash_without_scopes_attr() -> None:
    # Regression: AgentIdentity has permission_scopes, not scopes.
    identity = _identity()
    assert not hasattr(identity, "scopes")
    openai_brain_file_tool_definitions(identity, None)
