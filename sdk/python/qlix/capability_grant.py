"""Mid-run capability grant client — ask the user to add missing scopes, then continue."""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any


POLL_INTERVAL_S = 2.0
DEFAULT_TIMEOUT_S = 290.0


def _post_json(url: str, body: dict[str, Any], headers: dict[str, str], timeout_s: float = 60.0) -> dict[str, Any]:
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_json(url: str, headers: dict[str, str] | None = None, timeout_s: float = 30.0) -> dict[str, Any]:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def request_capability_and_wait(
    *,
    agent_id: str,
    runner_token: str,
    backend_url: str,
    scopes: list[str],
    reason: str,
    run_id: str | None = None,
    team_id: str | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> dict[str, Any]:
    """Create a capability-grant approval and block until the user decides.

    Returns a dict with at least ``status`` (approved|denied|expired) and, on
    approval, ``grantedScopes`` / live scope lists from the poll response.
    """
    token = (runner_token or os.environ.get("QLIX_RUNNER_TOKEN", "")).strip()
    aid = (agent_id or "").strip()
    base = (backend_url or "").rstrip("/")
    if not token or not aid or not base:
        return {
            "status": "denied",
            "error": "Capability grant requires runner authentication (QLIX_RUNNER_TOKEN).",
        }

    clean_scopes = [s.strip() for s in scopes if isinstance(s, str) and s.strip()]
    if not clean_scopes:
        return {"status": "denied", "error": "scopes is required"}

    body: dict[str, Any] = {
        "scopes": clean_scopes,
        "reason": (reason or "Needed for the current user request").strip()[:500],
    }
    if run_id:
        body["runId"] = run_id
    if team_id:
        body["teamId"] = team_id

    headers = {"X-QLIX-Runner-Token": token, "Authorization": f"Bearer {token}"}

    def _request() -> dict[str, Any]:
        return _post_json(
            f"{base}/api/v1/agents/{aid}/capability-grants/request",
            body,
            headers,
        )

    try:
        created = await asyncio.to_thread(_request)
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8")[:400]
        except Exception:
            pass
        return {
            "status": "denied",
            "error": f"Capability grant request failed ({exc.code}): {detail or exc.reason}",
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "denied", "error": f"Capability grant request failed: {exc}"}

    request_id = created.get("jitRequestId") or created.get("jit_request_id")
    poll_token = created.get("pollToken") or created.get("poll_token") or ""
    if not isinstance(request_id, str) or not request_id:
        return {"status": "denied", "error": "Capability grant did not return a request id"}

    if created.get("alreadyGranted") is True:
        return {
            "status": "approved",
            "alreadyGranted": True,
            "grantedScopes": clean_scopes,
            "permissionScopes": created.get("permissionScopes"),
            "jitScopes": created.get("jitScopes"),
            "alwaysScopes": created.get("alwaysScopes"),
        }

    poll_headers = dict(headers)
    if poll_token:
        poll_headers["X-Qlix-Jit-Poll-Token"] = str(poll_token)

    deadline = time.monotonic() + timeout_s
    while True:
        def _poll() -> dict[str, Any]:
            return _get_json(f"{base}/api/v1/jit/poll/{request_id}", headers=poll_headers)

        try:
            result = await asyncio.to_thread(_poll)
        except Exception as exc:  # noqa: BLE001
            return {"status": "denied", "error": f"Capability grant poll failed: {exc}"}

        status = str(result.get("status") or "")
        if status == "approved":
            return {
                "status": "approved",
                "grantedScopes": result.get("grantedScopes") or clean_scopes,
                "permissionScopes": result.get("permissionScopes"),
                "jitScopes": result.get("jitScopes"),
                "alwaysScopes": result.get("alwaysScopes"),
                "jitToken": result.get("jitToken") or result.get("jit_token"),
            }
        if status in ("denied", "expired"):
            return {"status": status}

        if time.monotonic() >= deadline:
            return {"status": "expired", "error": f"User did not respond within {timeout_s:.0f}s"}

        await asyncio.sleep(POLL_INTERVAL_S)
