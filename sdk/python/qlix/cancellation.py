"""Cooperative cancellation shared by runners, tools, and child resources."""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import inspect
import threading
from contextlib import contextmanager
from typing import Any, Awaitable, Callable, Iterator, TypeVar


T = TypeVar("T")
Cleanup = Callable[[], Any]


class CancellationToken:
    """Thread-safe stop signal with idempotent cleanup callbacks."""

    def __init__(self) -> None:
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._reason = "Run canceled"
        self._cleanups: list[Cleanup] = []

    @property
    def canceled(self) -> bool:
        return self._event.is_set()

    @property
    def reason(self) -> str:
        return self._reason

    def register_cleanup(self, callback: Cleanup) -> Callable[[], None]:
        run_now = False
        with self._lock:
            if self._event.is_set():
                run_now = True
            else:
                self._cleanups.append(callback)
        if run_now:
            self._run_cleanup(callback)

        def unregister() -> None:
            with self._lock:
                with contextlib.suppress(ValueError):
                    self._cleanups.remove(callback)

        return unregister

    def cancel(self, reason: str = "Run canceled") -> bool:
        with self._lock:
            if self._event.is_set():
                return False
            self._reason = reason or "Run canceled"
            self._event.set()
            cleanups = list(reversed(self._cleanups))
            self._cleanups.clear()
        for callback in cleanups:
            self._run_cleanup(callback)
        return True

    @staticmethod
    def _run_cleanup(callback: Cleanup) -> None:
        try:
            result = callback()
            if inspect.isawaitable(result):
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    return
                loop.create_task(result)
        except Exception:
            # Cleanup is best effort and must never replace the cancellation reason.
            pass


_CURRENT_TOKEN: contextvars.ContextVar[CancellationToken | None] = contextvars.ContextVar(
    "qlix_cancellation_token", default=None
)


def current_cancellation_token() -> CancellationToken | None:
    return _CURRENT_TOKEN.get()


@contextmanager
def cancellation_scope(token: CancellationToken) -> Iterator[CancellationToken]:
    marker = _CURRENT_TOKEN.set(token)
    try:
        yield token
    finally:
        _CURRENT_TOKEN.reset(marker)


async def await_with_cancellation(
    awaitable: Awaitable[T],
    *,
    token: CancellationToken,
    check: Callable[[], Awaitable[Any]],
    poll_interval: float = 0.5,
) -> T:
    """Run work while polling the authoritative backend cancellation state."""
    work = asyncio.ensure_future(awaitable)
    try:
        while True:
            done, _ = await asyncio.wait({work}, timeout=max(0.05, poll_interval))
            if done:
                return await work
            try:
                await check()
            except BaseException as exc:
                token.cancel(str(exc) or "Run canceled")
                work.cancel()
                with contextlib.suppress(BaseException):
                    await work
                raise
    except asyncio.CancelledError:
        token.cancel("Parent task canceled")
        work.cancel()
        with contextlib.suppress(BaseException):
            await work
        raise


__all__ = [
    "CancellationToken",
    "await_with_cancellation",
    "cancellation_scope",
    "current_cancellation_token",
]
