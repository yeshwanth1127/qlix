"""run_sync — the single named utility for crossing the async/sync boundary.

Every place in the ADK that needs to call an async function from synchronous
code uses this. Do not inline this logic elsewhere.

Pattern:
  - No running loop on this thread → ``loop.run_until_complete``
  - Running loop detected → hand off to a fresh thread with its own loop
    to avoid deadlock.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
from typing import Any, Coroutine, TypeVar

T = TypeVar("T")


def run_sync(coro: Coroutine[Any, Any, T]) -> T:
    """Run an async coroutine synchronously without deadlocking.

    Safe to call from:
    - A plain synchronous context (no running loop).
    - Inside a running event loop (e.g. FastAPI request handler, async test).

    Usage::

        result = run_sync(my_async_fn(arg1, arg2))
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Already inside an async context — spin up a worker thread with
            # its own event loop so we don't deadlock the current loop.
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result()
        else:
            return loop.run_until_complete(coro)
    except RuntimeError:
        # No event loop exists at all — create one.
        return asyncio.run(coro)


__all__ = ["run_sync"]
