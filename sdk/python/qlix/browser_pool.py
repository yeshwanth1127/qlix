"""Managed cloud browser pool (Browserbase / Cloudflare / generic CDP).

Primary path stays local Chromium (agent-browser). Cloudflare Browser Run is
resolved only for failover — see browser_failover.py — and is never eagerly
exported as QLIX_BROWSER_CDP_URL.

When QLIX_BROWSER_CDP_URL or Browserbase credentials are set, runners may
connect agent-browser to a remote CDP endpoint instead of launching local Chromium.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_CF_KEEP_ALIVE_MS = 600_000


def cloudflare_failover_enabled() -> bool:
    """Return True when Cloudflare Browser Run failover may be used."""
    raw = os.environ.get("QLIX_BROWSER_CF_FAILOVER", "1").strip().lower()
    if raw in ("0", "false", "off", "no"):
        return False
    from .research_providers import available_providers_for

    route = available_providers_for(
        "browser",
        runtime="cloud",
        public_tool="browser",
        include_browser_escalation=True,
    )
    return (
        any(spec["id"] == "cloudflare_browser_run" for spec in route)
        and resolve_cloudflare_failover() is not None
    )


def resolve_cloudflare_failover() -> dict[str, Any] | None:
    """Return Cloudflare Browser Run CDP URL + auth headers, or None.

    Does not mutate process env — callers activate failover explicitly.
    """
    account_id = (
        os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
        or os.environ.get("CF_ACCOUNT_ID", "").strip()
    )
    api_token = (
        os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
        or os.environ.get("CF_API_TOKEN", "").strip()
    )
    if not account_id or not api_token:
        return None

    keep_alive_raw = os.environ.get("QLIX_BROWSER_CF_KEEP_ALIVE_MS", "").strip()
    try:
        keep_alive = max(30_000, int(keep_alive_raw)) if keep_alive_raw else _DEFAULT_CF_KEEP_ALIVE_MS
    except ValueError:
        keep_alive = _DEFAULT_CF_KEEP_ALIVE_MS

    url = (
        f"wss://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/browser-rendering/devtools/browser?keep_alive={keep_alive}"
    )
    return {
        "provider": "cloudflare",
        "url": url,
        "headers": {"Authorization": f"Bearer {api_token}"},
        "keep_alive_ms": keep_alive,
    }


def resolve_managed_cdp_url() -> str | None:
    """Return a CDP websocket/HTTP URL for a managed browser, if configured.

    Explicit QLIX_BROWSER_CDP_URL / Browserbase only — Cloudflare is failover-only
    and is not returned here.
    """
    from .research_providers import available_providers_for

    route = available_providers_for(
        "browser",
        runtime="cloud",
        public_tool="browser",
        include_browser_escalation=True,
    )
    provider_ids = tuple(str(spec["id"]) for spec in route)
    if "generic_remote_cdp" in provider_ids:
        direct = os.environ.get("QLIX_BROWSER_CDP_URL", "").strip()
        if direct:
            return direct
    # Preserve the documented direct Browserbase URL override even when session
    # creation credentials are intentionally absent.
    browserbase_direct = os.environ.get("BROWSERBASE_CDP_URL", "").strip()
    if browserbase_direct:
        return browserbase_direct

    api_key = os.environ.get("BROWSERBASE_API_KEY", "").strip()
    project_id = os.environ.get("BROWSERBASE_PROJECT_ID", "").strip()
    if "browserbase" not in provider_ids or not api_key or not project_id:
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
