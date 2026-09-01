"""agent.json loader + validator.

Place your downloaded **agent.json** anywhere on disk and point the SDK at it with::

    export QLIX_AGENT_FILE=/absolute/path/to/agent.json

(or ``agent_file=`` when constructing :class:`~qlix.sdk.QlixSDK`).

Schema (from agent creation / dashboard download):

    {
      "did":              "did:qlix:...",
      "agent_id":         "<cuid>",
      "private_key":      "<hex-encoded ed25519 seed, 64 chars>",
      "public_key":       "<hex-encoded ed25519 public key, 64 chars>",
      "permission_scopes": ["web.read", ...],
      "jit_scopes":       [...],
      "always_scopes":    [...],
      "llm_mode":         "direct" | "proxy",
      "backend_url":      "https://api.example.com",
      "issued_at":        "2026-05-03T08:00:00Z"
    }

Both camelCase and snake_case keys are accepted on load.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .exceptions import IdentityError

DEFAULT_BACKEND_URL = "http://localhost:8080"

ENV_AGENT_FILE = "QLIX_AGENT_FILE"
ENV_AGENT_JSON_B64 = "QLIX_AGENT_JSON_B64"


def _default_agent_json_candidates() -> list[Path]:
    """Starter-pack layout: agent.json next to cwd or this module."""
    candidates: list[Path] = []
    cwd_file = Path.cwd() / "agent.json"
    candidates.append(cwd_file)
    here = Path(__file__).resolve().parent
    for base in (here, here.parent, here.parent.parent):
        candidates.append(base / "agent.json")
    return candidates


def resolve_agent_json_path(explicit: str | os.PathLike[str] | None) -> Path:
    """Path to agent.json: explicit argument wins, else env, else starter-pack ``agent.json``."""
    if explicit is not None:
        return Path(explicit).expanduser().resolve()
    raw = os.environ.get(ENV_AGENT_FILE)
    if raw and str(raw).strip():
        return Path(raw.strip()).expanduser().resolve()
    for candidate in _default_agent_json_candidates():
        if candidate.is_file():
            return candidate.resolve()
    raise IdentityError(
        "Set QLIX_AGENT_FILE to your agent.json path, or unzip the Qlix starter pack "
        "and run Start Qlix Agent from that folder."
    )


@dataclass(frozen=True)
class AgentIdentity:
    did: str
    agent_id: str
    private_key_hex: str = field(repr=False)
    public_key_hex: str
    permission_scopes: tuple[str, ...]
    jit_scopes: tuple[str, ...]
    always_scopes: tuple[str, ...]
    backend_url: str
    llm_mode: str  # "direct" | "proxy"
    raw: dict[str, Any] = field(repr=False, compare=False)

    def has_scope(self, action_type: str) -> bool:
        return action_type in self.permission_scopes

    def is_jit(self, action_type: str) -> bool:
        return action_type in self.jit_scopes

    def is_always(self, action_type: str) -> bool:
        return action_type in self.always_scopes


def _pick(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in d:
            return d[k]
    return None


def _require_hex(value: Any, *, field_name: str, expected_len: int) -> str:
    if not isinstance(value, str) or not value:
        raise IdentityError(f"{field_name} must be a non-empty hex string")
    try:
        bytes.fromhex(value)
    except ValueError as exc:
        raise IdentityError(f"{field_name} is not valid hex") from exc
    if len(value) != expected_len:
        raise IdentityError(
            f"{field_name} must be {expected_len} hex chars (got {len(value)})"
        )
    return value.lower()


def _require_str_list(value: Any, *, field_name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(s, str) for s in value):
        raise IdentityError(f"{field_name} must be a list of strings")
    return tuple(value)


def parse_identity(data: dict[str, Any]) -> AgentIdentity:
    """Validate a raw agent.json dict and return a frozen AgentIdentity."""
    if not isinstance(data, dict):
        raise IdentityError("agent.json root must be a JSON object")

    did = _pick(data, "did")
    if not isinstance(did, str) or not did.startswith("did:"):
        raise IdentityError("did is missing or does not start with 'did:'")

    agent_id = _pick(data, "agent_id", "agentId", "id")
    if not isinstance(agent_id, str) or not agent_id:
        raise IdentityError("agent_id is missing")

    private_key = _require_hex(
        _pick(data, "private_key", "privateKey"),
        field_name="private_key",
        expected_len=64,
    )
    public_key = _require_hex(
        _pick(data, "public_key", "publicKey"),
        field_name="public_key",
        expected_len=64,
    )

    permission_scopes = _require_str_list(
        _pick(data, "permission_scopes", "permissionScopes"),
        field_name="permission_scopes",
    )
    jit_scopes = _require_str_list(
        _pick(data, "jit_scopes", "jitScopes"),
        field_name="jit_scopes",
    )
    always_scopes = _require_str_list(
        _pick(data, "always_scopes", "alwaysScopes"),
        field_name="always_scopes",
    )

    backend_url = _pick(data, "backend_url", "backendUrl") or os.environ.get(
        "QLIX_BACKEND_URL"
    ) or DEFAULT_BACKEND_URL
    if not isinstance(backend_url, str) or not backend_url.startswith(("http://", "https://")):
        raise IdentityError("backend_url must be an http(s) URL")

    llm_mode = _pick(data, "llm_mode", "llmMode") or "proxy"
    if llm_mode not in ("direct", "proxy"):
        raise IdentityError('llm_mode must be "direct" or "proxy"')

    return AgentIdentity(
        did=did,
        agent_id=agent_id,
        private_key_hex=private_key,
        public_key_hex=public_key,
        permission_scopes=permission_scopes,
        jit_scopes=jit_scopes,
        always_scopes=always_scopes,
        backend_url=backend_url.rstrip("/"),
        llm_mode=llm_mode,
        raw=data,
    )


def extract_sdk_agent_file(api_json: dict[str, Any]) -> dict[str, Any]:
    """Return the ``sdkAgentFile`` object from a ``POST /api/v1/agents`` ``201`` body."""
    blob = api_json.get("sdkAgentFile") or api_json.get("sdk_agent_file")
    if blob is None:
        raise IdentityError("API response has no sdkAgentFile field")
    if not isinstance(blob, dict):
        raise IdentityError("sdkAgentFile must be a JSON object")
    out = dict(blob)
    out.pop("sdk_agent_folder", None)
    return out


def save_sdk_agent_json(path: str | os.PathLike[str], data: dict[str, Any]) -> Path:
    """Validate ``data`` and write it to ``path`` (parent dirs created)."""
    work = {k: v for k, v in data.items() if k != "sdk_agent_folder"}
    parse_identity(work)
    p = Path(path).expanduser().resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(work, indent=2, ensure_ascii=False) + "\n"
    p.write_text(text, encoding="utf-8")
    return p


def load_identity(path: str | os.PathLike[str] | None = None) -> AgentIdentity:
    """Load agent credentials from ``path`` or from ``QLIX_AGENT_FILE``."""
    inline = os.environ.get(ENV_AGENT_JSON_B64, "").strip()
    if path is None and not os.environ.get(ENV_AGENT_FILE, "").strip() and inline:
        try:
            decoded = base64.b64decode(inline, validate=True).decode("utf-8")
            data = json.loads(decoded)
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise IdentityError(f"{ENV_AGENT_JSON_B64} is not valid base64 JSON") from exc
        return parse_identity(data)
    file_path = resolve_agent_json_path(path)
    if not file_path.exists():
        raise IdentityError(f"agent.json not found at {file_path}")
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise IdentityError(f"agent.json is not valid JSON: {exc}") from exc
    return parse_identity(data)
