"""Playwright-backed browser driver (local dev fallback)."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger("qlix.luna.browser.playwright")


class PlaywrightDriver:
    """Manages a shared Playwright browser session (lazy init)."""

    def __init__(self) -> None:
        self._playwright = None
        self._browser = None
        self._page = None

        headless_raw = os.environ.get("LUNA_BROWSER_HEADLESS", "").strip().lower()
        if headless_raw in ("0", "false", "no", "off"):
            self._headless = False
        elif headless_raw in ("1", "true", "yes", "on"):
            self._headless = True
        else:
            self._headless = True

    def _launch_playwright_browser(self, pw) -> Any:
        chromium = pw.chromium
        launch_kwargs: dict[str, Any] = {"headless": self._headless}
        executable = os.environ.get("LUNA_PLAYWRIGHT_EXECUTABLE", "").strip()
        channel = os.environ.get("LUNA_PLAYWRIGHT_CHANNEL", "").strip().lower()
        valid_channels = frozenset(
            {"chrome", "msedge", "chrome-beta", "chrome-dev", "chrome-canary"}
        )

        if executable:
            launch_kwargs["executable_path"] = executable
            return chromium.launch(**launch_kwargs)

        if channel:
            if channel in valid_channels:
                launch_kwargs["channel"] = channel
            return chromium.launch(**launch_kwargs)

        if not self._headless:
            try:
                return chromium.launch(channel="chrome", headless=False)
            except Exception as exc:
                logger.warning(
                    "Playwright could not launch channel=chrome (%s); using bundled Chromium.",
                    exc,
                )
                return chromium.launch(headless=False)

        return chromium.launch(**launch_kwargs)

    def _ensure_browser(self) -> None:
        if self._page is not None:
            return
        from playwright.sync_api import sync_playwright

        self._playwright = sync_playwright().start()
        self._browser = self._launch_playwright_browser(self._playwright)
        self._page = self._browser.new_page()

    @property
    def page(self) -> Any:
        self._ensure_browser()
        return self._page

    def navigate(self, url: str, wait_for: str = "load") -> dict[str, Any]:
        if wait_for not in ("load", "domcontentloaded", "networkidle"):
            wait_for = "load"
        page = self.page
        response = page.goto(url, wait_until=wait_for)
        text_content = page.inner_text("body")
        return {
            "url": url,
            "title": page.title(),
            "status": response.status if response else None,
            "text": text_content,
        }

    def click(self, selector: str, *, by_text: bool = False) -> None:
        page = self.page
        if by_text:
            page.get_by_text(selector).click()
        else:
            page.click(selector)

    def fill(self, selector: str, text: str, *, clear: bool = True) -> None:
        page = self.page
        if clear:
            page.fill(selector, text)
        else:
            page.type(selector, text)

    def screenshot_bytes(self, *, full_page: bool = False) -> bytes:
        return self.page.screenshot(full_page=full_page)

    def extract_text(self, selector: str = "body") -> str:
        return self.page.inner_text(selector)

    def extract_links(self, selector: str = "body") -> list[dict[str, str]]:
        return self.page.eval_on_selector_all(
            f"{selector} a[href]",
            """elements => elements.map(el => ({
                href: el.href,
                text: el.innerText.trim()
            }))""",
        )

    def extract_tables(self, selector: str = "body") -> list[str]:
        return self.page.eval_on_selector_all(
            f"{selector} table",
            "elements => elements.map(el => el.innerText)",
        )

    def accessibility_snapshot(self) -> dict[str, Any] | None:
        return self.page.accessibility.snapshot()

    def close(self) -> None:
        if self._browser:
            self._browser.close()
        if self._playwright:
            self._playwright.stop()
        self._playwright = self._browser = self._page = None
