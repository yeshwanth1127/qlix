"""Warm up agent-browser daemon before tool use (cloud runner)."""

from __future__ import annotations

import logging
import os
import subprocess

from qlix.luna.browser.paths import resolve_agent_browser_binary

logger = logging.getLogger("qlix.luna.browser.warmup")

_SOCKET_DIR = os.environ.get("AGENT_BROWSER_SOCKET_DIR", "/tmp/agent-browser")


def ensure_agent_browser_socket_dir() -> None:
    os.makedirs(_SOCKET_DIR, exist_ok=True)


def warmup_agent_browser(session: str) -> None:
    """Start daemon and verify browser launch; repair stale sockets if needed."""
    ensure_agent_browser_socket_dir()
    env = os.environ.copy()
    env["AGENT_BROWSER_SESSION"] = session
    env["AGENT_BROWSER_SOCKET_DIR"] = _SOCKET_DIR
    env.setdefault("LUNA_BROWSER_HEADLESS", "1")

    try:
        binary = str(resolve_agent_browser_binary())
    except FileNotFoundError as exc:
        logger.warning("agent_browser_warmup_skip: %s", exc)
        return

    def run(*args: str, timeout: int = 90) -> subprocess.CompletedProcess[str]:
        cmd = [binary, *args]
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            check=False,
        )

    run("doctor", "--fix", timeout=120)
    probe = run("--json", "open", "about:blank")
    if probe.returncode != 0 and not (probe.stdout or "").strip():
        logger.warning(
            "agent_browser_warmup_open_failed exit=%s stderr=%s",
            probe.returncode,
            (probe.stderr or "")[:500],
        )
    else:
        run("--json", "close")
        logger.info("agent_browser_warmup_ok session=%s", session)
