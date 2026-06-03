"""Select browser engine from environment."""

from __future__ import annotations

import logging
import os

from qlix.luna.browser.agent_browser_driver import AgentBrowserDriver
from qlix.luna.browser.driver import BrowserDriver
from qlix.luna.browser.playwright_driver import PlaywrightDriver

logger = logging.getLogger("qlix.luna.browser")

_driver: BrowserDriver | None = None


def _headless_from_env() -> bool:
    raw = os.environ.get("LUNA_BROWSER_HEADLESS", "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    return True


def browser_engine_name() -> str:
    return os.environ.get("LUNA_BROWSER_ENGINE", "playwright").strip().lower()


def get_browser_engine_info() -> dict[str, str]:
    """Engine id plus install details (for runner logs / UI activity)."""
    engine = browser_engine_name()
    if engine in ("agent_browser", "agent-browser", "agentbrowser"):
        try:
            from qlix.luna.browser.paths import describe_agent_browser_install

            return {"engine": "agent_browser", **describe_agent_browser_install()}
        except FileNotFoundError as exc:
            return {"engine": "agent_browser", "binary": "", "error": str(exc)}
    return {
        "engine": "playwright",
        "headless": str(_headless_from_env()).lower(),
    }


def get_browser_driver() -> BrowserDriver:
    global _driver
    if _driver is not None:
        return _driver

    engine = browser_engine_name()
    if engine in ("agent_browser", "agent-browser", "agentbrowser"):
        try:
            info = get_browser_engine_info()
            _driver = AgentBrowserDriver(headless=_headless_from_env())
            logger.info(
                "browser_engine=agent_browser session=%s binary=%s cli_version=%s npm=%s",
                os.environ.get("AGENT_BROWSER_SESSION", "default"),
                info.get("binary", ""),
                info.get("cli_version", ""),
                info.get("npm_global_version", ""),
            )
            return _driver
        except FileNotFoundError as exc:
            logger.warning("agent_browser unavailable (%s); falling back to playwright", exc)

    _driver = PlaywrightDriver()
    logger.info("browser_engine=playwright")
    return _driver


def reset_browser_driver() -> None:
    global _driver
    if _driver is not None:
        try:
            _driver.close()
        except Exception:
            pass
    _driver = None
