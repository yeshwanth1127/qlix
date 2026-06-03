"""Dev mode utilities for the Qlix ADK.

``QLIX_DEV=1`` is the single env var that activates dev mode. When set:

  * ``@qlix.tool`` functions are called directly — no scope check, no JIT,
    no billing, no backend calls.
  * The identity gate is bypassed — no ``agent.json`` required.
  * ``QlixSDK()`` works without credentials, using a placeholder identity.

Use the :func:`dev_mode` context manager in tests and local scripts::

    async def main():
        async with qlix.dev_mode():
            result = await my_tool(url="https://example.com")
            print(result)

Or set the env var directly before running your script::

    QLIX_DEV=1 python my_agent.py
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator


def is_dev_mode() -> bool:
    """Return True if ``QLIX_DEV=1`` is set in the environment."""
    return os.environ.get("QLIX_DEV") == "1"


@asynccontextmanager
async def dev_mode() -> AsyncIterator[None]:
    """Async context manager that activates dev mode for its duration.

    Sets ``QLIX_DEV=1`` on entry and restores the original value on exit.
    Safe to nest — restores whatever was there before, not just unsets.

    Usage::

        async with qlix.dev_mode():
            result = await fetch_page(url="https://example.com")
    """
    prev = os.environ.get("QLIX_DEV")
    os.environ["QLIX_DEV"] = "1"
    try:
        yield
    finally:
        if prev is None:
            os.environ.pop("QLIX_DEV", None)
        else:
            os.environ["QLIX_DEV"] = prev


__all__ = ["dev_mode", "is_dev_mode"]
