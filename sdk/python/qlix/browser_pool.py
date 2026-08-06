"""Managed cloud browser pool (Browserbase / Browser Use / generic CDP).

When QLIX_BROWSER_CDP_URL or Browserbase credentials are set, runners connect
agent-browser to a remote CDP endpoint instead of launching a local Chromium.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def resolve_managed_cdp_url() -> str | None:
    """Return a CDP websocket/HTTP URL for a managed browser, if configured."""
    direct = (
        os.environ.get("QLIX_BROWSER_CDP_URL", "").strip()
        or os.environ.get("BROWSERBASE_CDP_URL", "").strip()
    )
    if direct:
        return direct

    api_key = os.environ.get("BROWSERBASE_API_KEY", "").strip()
    project_id = os.environ.get("BROWSERBASE_PROJECT_ID", "").strip()
    if not api_key or not project_id:
        return None

    try:
        import urllib.request

        req = urllib.request.Request(
            "https://www.browserbase.com/v1/sessions",
            data=b'{"projectId":"' + project_id.encode() + b'"}',
            headers={
                "Content-Type": "application/json",
                "X-BB-API-Key": api_key,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
        import json

        data: dict[str, Any] = json.loads(body)
        # Browserbase returns connectUrl / connect_url depending on API version.
        url = data.get("connectUrl") or data.get("connect_url") or data.get("wsEndpoint")
        if isinstance(url, str) and url.strip():
            logger.info("browser_pool: created Browserbase session")
            return url.strip()
        logger.warning("browser_pool: Browserbase session response missing connect URL")
    except Exception as exc:  # noqa: BLE001
        logger.warning("browser_pool: Browserbase session create failed: %s", exc)
    return None


def ensure_managed_browser_env() -> str | None:
    """If a managed CDP URL is available, export it for agent-browser connect."""
    url = resolve_managed_cdp_url()
    if not url:
        return None
    os.environ.setdefault("QLIX_BROWSER_CDP_URL", url)
    # agent-browser CLI honors AGENT_BROWSER_CDP / similar; set common aliases.
    os.environ.setdefault("AGENT_BROWSER_CDP_URL", url)
    return url
