"""Playwright-backed browser driver (local dev fallback + remote CDP)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("qlix.luna.browser.playwright")


class PlaywrightDriver:
    """Manages a shared Playwright browser session (lazy init)."""

    def __init__(
        self,
        *,
        cdp_url: str | None = None,
        cdp_headers: dict[str, str] | None = None,
    ) -> None:
        self._playwright = None
        self._browser = None
        self._page = None
        self._cdp_url = (cdp_url or "").strip() or None
        self._cdp_headers = dict(cdp_headers) if cdp_headers else None

        headless_raw = os.environ.get("LUNA_BROWSER_HEADLESS", "").strip().lower()
        if headless_raw in ("0", "false", "no", "off"):
            self._headless = False
        elif headless_raw in ("1", "true", "yes", "on"):
            self._headless = True
        else:
            self._headless = True

    def _resolve_cdp_from_env(self) -> tuple[str | None, dict[str, str] | None]:
        if self._cdp_url:
            return self._cdp_url, self._cdp_headers
        url = os.environ.get("QLIX_BROWSER_CDP_URL", "").strip()
        if not url:
            return None, None
        headers: dict[str, str] | None = None
        raw_headers = os.environ.get("QLIX_BROWSER_CDP_HEADERS_JSON", "").strip()
        if raw_headers:
            try:
                parsed = json.loads(raw_headers)
                if isinstance(parsed, dict):
                    headers = {str(k): str(v) for k, v in parsed.items()}
            except json.JSONDecodeError:
                logger.warning("playwright: invalid QLIX_BROWSER_CDP_HEADERS_JSON")
        return url, headers

    def _launch_playwright_browser(self, pw) -> Any:
        chromium = pw.chromium
        cdp_url, cdp_headers = self._resolve_cdp_from_env()
        if cdp_url:
            connect_kwargs: dict[str, Any] = {}
            if cdp_headers:
                connect_kwargs["headers"] = cdp_headers
            logger.info("playwright: connect_over_cdp url=%s headers=%s", cdp_url, bool(cdp_headers))
            return chromium.connect_over_cdp(cdp_url, **connect_kwargs)

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
        # Remote CDP sessions often already have a default context/page.
        try:
            contexts = list(getattr(self._browser, "contexts", []) or [])
            if contexts:
                pages = list(getattr(contexts[0], "pages", []) or [])
                if pages:
                    self._page = pages[0]
                    return
                self._page = contexts[0].new_page()
                return
        except Exception as exc:  # noqa: BLE001
            logger.debug("playwright: reuse remote context failed: %s", exc)
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
