"""Identity gate for the Luna runtime.

The Luna runtime is bundled inside the ``qlix`` SDK but only operates while a
:class:`qlix.QlixSDK` instance with a valid agent identity is alive. This
module is the chokepoint:

* :class:`qlix.QlixSDK` calls :func:`set_active_sdk` from its constructor.
* :class:`qlix.luna.system.builder.SystemBuilder.build` calls
  :func:`require_active_sdk` before producing a usable runtime.
* :func:`qlix.luna.tools._stubs.BaseTool.run` calls :func:`require_active_sdk`
  for defense-in-depth — even a hand-built tool object refuses to run.

The gate is *not* a cryptographic protection on its own. The cryptographic
protection is server-side: every tool execution must POST a signed
``/actions/start`` payload that the Qlix backend verifies against the
agent's stored public key. The gate is a fail-fast check that surfaces a
clear error to honest users who haven't wired up an SDK yet.

License terms (Elastic License 2.0) explicitly forbid removing or
circumventing this gate.
"""

from __future__ import annotations

import os
from typing import Any, Optional

# Inline check to avoid a circular import — _gate is imported very early
# in the Luna bootstrap and qlix.dev is not available at that point.
# is_dev_mode() in dev.py is the canonical implementation; this must match it.
def _is_dev_mode() -> bool:
    return os.environ.get("QLIX_DEV") == "1"

_active_sdk: Optional[Any] = None  # holds a qlix.QlixSDK


def set_active_sdk(sdk: Any) -> None:
    """Register the active QlixSDK. Called by ``QlixSDK.__init__``."""
    global _active_sdk
    _active_sdk = sdk


def clear_active_sdk() -> None:
    """Unregister. Called by ``QlixSDK.aclose``."""
    global _active_sdk
    _active_sdk = None


def get_active_sdk() -> Optional[Any]:
    return _active_sdk


def require_active_sdk() -> Any:
    """Return the active SDK or raise a clear error.

    Bypass for offline development only:
        QLIX_DEV=1            # dev mode — skips the gate and all billing.
        QLIX_DISABLE_GATE=1   # legacy alias; disables the local check only.
    """
    if _is_dev_mode() or os.environ.get("QLIX_DISABLE_GATE") == "1":
        return _active_sdk
    if _active_sdk is None:
        raise IdentityGateError(
            "Luna runtime requires an active QlixSDK with a valid agent.json. "
            "Construct `qlix.QlixSDK()` (set QLIX_AGENT_FILE or pass "
            "agent_file=...) before building or invoking Luna components. "
            "See https://qlix.dev for issuing an agent identity."
        )
    return _active_sdk


class IdentityGateError(RuntimeError):
    """Raised when Luna code is invoked without an active QlixSDK identity."""


__all__ = [
    "IdentityGateError",
    "clear_active_sdk",
    "get_active_sdk",
    "require_active_sdk",
    "set_active_sdk",
]
