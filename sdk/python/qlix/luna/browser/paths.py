"""Resolve agent-browser CLI from npm global install or PATH."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

# Pin cloud Docker installs to this release (see docker/cloud-runner/Dockerfile).
AGENT_BROWSER_NPM_VERSION = "0.9.4"


def resolve_agent_browser_binary() -> Path:
    """Return path to agent-browser executable (npm global or PATH)."""
    override = os.environ.get("AGENT_BROWSER_BIN", "").strip()
    if override:
        path = Path(override)
        if not path.is_file():
            raise FileNotFoundError(f"AGENT_BROWSER_BIN not found: {path}")
        return path

    on_path = shutil.which("agent-browser")
    if on_path:
        return Path(on_path)

    raise FileNotFoundError(
        "agent-browser not found on PATH. "
        f"Install with: npm install -g agent-browser@{AGENT_BROWSER_NPM_VERSION} "
        "and run `agent-browser install` (Linux: `install --with-deps`). "
        "Or set LUNA_BROWSER_ENGINE=playwright for local dev."
    )


def describe_agent_browser_install() -> dict[str, str]:
    """Diagnostics: binary path and CLI/npm version strings for logs."""
    binary = resolve_agent_browser_binary()
    info: dict[str, str] = {
        "binary": str(binary),
        "expected_npm_version": AGENT_BROWSER_NPM_VERSION,
        "cli_version": "",
        "npm_global_version": "",
    }
    try:
        proc = subprocess.run(
            [str(binary), "--version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        info["cli_version"] = (proc.stdout or proc.stderr or "").strip()[:200]
    except Exception as exc:
        info["cli_version"] = f"unavailable ({exc})"

    npm = shutil.which("npm")
    if npm:
        try:
            proc = subprocess.run(
                [npm, "list", "-g", "agent-browser", "--depth=0"],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            info["npm_global_version"] = (proc.stdout or proc.stderr or "").strip()[:300]
        except Exception as exc:
            info["npm_global_version"] = f"unavailable ({exc})"
    return info
