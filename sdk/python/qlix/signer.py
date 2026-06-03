"""Ed25519 signing + canonicalization.

The canonical JSON form MUST byte-match the backend's canonicalize() in
backend/src/actions/canonical.ts:

    - object keys sorted lexicographically at every depth
    - arrays preserve order
    - no whitespace between tokens
    - non-ASCII characters preserved (no \\u escaping)
    - keys whose value is None are dropped (matches the TS rule for `undefined`)
"""

from __future__ import annotations

import json
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from .exceptions import SignatureError


def _drop_nones(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _drop_nones(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_drop_nones(v) for v in value]
    return value


def canonicalize(payload: dict[str, Any]) -> bytes:
    """Return the exact byte sequence the signature is computed over."""
    cleaned = _drop_nones(payload)
    text = json.dumps(
        cleaned,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
    return text.encode("utf-8")


def _load_private_key(private_key_hex: str) -> Ed25519PrivateKey:
    try:
        seed = bytes.fromhex(private_key_hex)
    except ValueError as exc:
        raise SignatureError("private_key is not valid hex") from exc
    if len(seed) != 32:
        raise SignatureError(
            f"private_key seed must be 32 bytes ({len(seed)} given)"
        )
    return Ed25519PrivateKey.from_private_bytes(seed)


def _load_public_key(public_key_hex: str) -> Ed25519PublicKey:
    try:
        raw = bytes.fromhex(public_key_hex)
    except ValueError as exc:
        raise SignatureError("public_key is not valid hex") from exc
    if len(raw) != 32:
        raise SignatureError(
            f"public_key must be 32 bytes ({len(raw)} given)"
        )
    return Ed25519PublicKey.from_public_bytes(raw)


def sign_payload(payload: dict[str, Any], *, private_key_hex: str) -> str:
    """Sign canonicalize(payload) and return a hex-encoded signature."""
    sk = _load_private_key(private_key_hex)
    sig = sk.sign(canonicalize(payload))
    return sig.hex()


def verify_payload(
    payload: dict[str, Any], *, signature_hex: str, public_key_hex: str
) -> bool:
    """Verify a hex signature over canonicalize(payload)."""
    pk = _load_public_key(public_key_hex)
    try:
        sig = bytes.fromhex(signature_hex)
    except ValueError:
        return False
    try:
        pk.verify(sig, canonicalize(payload))
    except InvalidSignature:
        return False
    return True
