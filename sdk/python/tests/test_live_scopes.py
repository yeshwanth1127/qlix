"""Live scopes from runs/poll must override boot-time agent.json identity."""

from __future__ import annotations

from qlix.identity import AgentIdentity
from qlix.runner_common import identity_with_live_scopes


def _identity(**overrides: object) -> AgentIdentity:
    base = dict(
        did="did:qlix:test",
        agent_id="agent_1",
        private_key_hex="ab" * 32,
        public_key_hex="cd" * 32,
        permission_scopes=("web.read",),
        jit_scopes=(),
        always_scopes=("web.read",),
        backend_url="http://localhost:4000",
        llm_mode="proxy",
        raw={},
    )
    base.update(overrides)
    return AgentIdentity(**base)  # type: ignore[arg-type]


def test_identity_with_live_scopes_adds_email_read() -> None:
    identity = _identity()
    run = {
        "permissionScopes": ["web.read", "email.read"],
        "jitScopes": [],
        "alwaysScopes": ["web.read", "email.read"],
    }
    live = identity_with_live_scopes(identity, run)
    assert "email.read" in live.permission_scopes
    assert "email.read" in live.always_scopes
    assert "email.read" not in identity.permission_scopes


def test_identity_with_live_scopes_falls_back_when_missing() -> None:
    identity = _identity(permission_scopes=("web.read", "email.read"))
    live = identity_with_live_scopes(identity, {"toolProfile": "full"})
    assert live.permission_scopes == identity.permission_scopes


def test_identity_with_live_scopes_accepts_snake_case() -> None:
    identity = _identity()
    run = {
        "permission_scopes": ["email.read"],
        "jit_scopes": ["email.send"],
        "always_scopes": ["email.read"],
    }
    live = identity_with_live_scopes(identity, run)
    assert live.permission_scopes == ("email.read",)
    assert live.jit_scopes == ("email.send",)
    assert live.always_scopes == ("email.read",)
