from __future__ import annotations

import base64
import json

import pytest

from qlix.exceptions import IdentityError
from qlix.identity import ENV_AGENT_FILE, ENV_AGENT_JSON_B64, load_identity


def _identity() -> dict[str, object]:
    return {
        "did": "did:qlix:cloud-test",
        "agent_id": "agent-cloud-test",
        "private_key": "ab" * 32,
        "public_key": "cd" * 32,
        "permission_scopes": ["web.read"],
        "jit_scopes": [],
        "always_scopes": [],
        "backend_url": "https://api.example.test",
        "llm_mode": "proxy",
    }


def test_load_identity_from_ephemeral_base64_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ENV_AGENT_FILE, raising=False)
    payload = base64.b64encode(json.dumps(_identity()).encode()).decode()
    monkeypatch.setenv(ENV_AGENT_JSON_B64, payload)

    identity = load_identity()

    assert identity.agent_id == "agent-cloud-test"
    assert identity.private_key_hex == "ab" * 32
    assert "ab" * 32 not in repr(identity)


def test_invalid_ephemeral_identity_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ENV_AGENT_FILE, raising=False)
    monkeypatch.setenv(ENV_AGENT_JSON_B64, "not-base64")

    with pytest.raises(IdentityError, match="not valid base64 JSON"):
        load_identity()
