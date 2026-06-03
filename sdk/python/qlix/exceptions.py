"""Typed SDK exceptions. Catch these at the call site of qlix.run()."""

from __future__ import annotations


class QlixError(Exception):
    """Base class for all Qlix SDK errors."""


class IdentityError(QlixError):
    """agent.json is missing, malformed, or fails schema validation."""


class SignatureError(QlixError):
    """Local signing failed — usually a corrupt or wrong-length private key."""


class HttpError(QlixError):
    """Backend returned a non-2xx status the SDK could not recover from."""

    def __init__(self, message: str, *, status_code: int, body: object | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class DeviceNotVerifiedError(QlixError):
    """Backend rejected the request because the agent's device is unverified."""


class PermissionDeniedError(QlixError):
    """A JIT-scoped action was denied by the user, or the scope is not granted."""


class JITTimeoutError(QlixError):
    """A JIT approval was not granted within the polling window."""


class ScopeError(QlixError):
    """The action_type is not in the agent's permission_scopes."""


class ReplayError(QlixError):
    """Backend rejected our timestamp as stale — usually clock skew."""
