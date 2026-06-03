"""Browser driver protocol — Playwright or agent-browser."""

from __future__ import annotations

from typing import Any, Protocol


class BrowserDriver(Protocol):
    @property
    def page(self) -> Any:
        """Playwright page when using Playwright; driver self for agent-browser shim."""

    def navigate(self, url: str, wait_for: str = "load") -> dict[str, Any]:
        """Navigate; returns metadata with title, url, status, text preview."""

    def click(self, selector: str, *, by_text: bool = False) -> None:
        ...

    def fill(self, selector: str, text: str, *, clear: bool = True) -> None:
        ...

    def screenshot_bytes(self, *, full_page: bool = False) -> bytes:
        ...

    def extract_text(self, selector: str = "body") -> str:
        ...

    def extract_links(self, selector: str = "body") -> list[dict[str, str]]:
        ...

    def extract_tables(self, selector: str = "body") -> list[str]:
        ...

    def accessibility_snapshot(self) -> dict[str, Any] | None:
        ...

    def close(self) -> None:
        ...
