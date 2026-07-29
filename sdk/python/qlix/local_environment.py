"""Probe the hybrid runner host OS and sync facts to Qlix agent memory."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping

_CACHED: dict[str, Any] | None = None
_SYNCED_FINGERPRINT: str | None = None


def _run_shell(code: str, *, timeout: int = 15) -> str:
    """Run a one-liner via PowerShell (Windows) or bash (Unix)."""
    try:
        if platform.system() == "Windows":
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", code],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        else:
            proc = subprocess.run(
                ["/bin/bash", "-lc", code],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        if proc.returncode != 0:
            return ""
        return (proc.stdout or "").strip()
    except (subprocess.TimeoutExpired, OSError):
        return ""


def probe_local_environment() -> dict[str, Any]:
    """Discover local user paths via shell commands, with Python fallbacks."""
    is_windows = platform.system() == "Windows"
    if is_windows:
        whoami = _run_shell("whoami") or os.environ.get("USERNAME", "")
        username = _run_shell("$env:USERNAME") or whoami.split("\\")[-1].strip()
        home = _run_shell('[Environment]::GetFolderPath("UserProfile")') or str(Path.home())
        documents = _run_shell('[Environment]::GetFolderPath("MyDocuments")')
        desktop = _run_shell('[Environment]::GetFolderPath("Desktop")')
        cwd = _run_shell("(Get-Location).Path") or os.getcwd()
    else:
        whoami = _run_shell("whoami") or ""
        username = _run_shell("id -un") or whoami.split("@")[0].strip()
        home = _run_shell("printf %s \"$HOME\"") or str(Path.home())
        documents = _run_shell("printf %s \"$HOME/Documents\"") or str(Path.home() / "Documents")
        desktop = _run_shell("printf %s \"$HOME/Desktop\"") or str(Path.home() / "Desktop")
        cwd = _run_shell("pwd") or os.getcwd()

    home_path = Path(home).expanduser()
    docs_path = Path(documents).expanduser() if documents else home_path / "Documents"
    if not docs_path.is_dir():
        docs_path = home_path / "Documents"
    if not docs_path.is_dir():
        import tempfile

        docs_path = Path(tempfile.gettempdir())

    desktop_path = Path(desktop).expanduser() if desktop else home_path / "Desktop"
    if not desktop_path.is_dir():
        desktop_path = home_path / "Desktop"

    env: dict[str, Any] = {
        "os": platform.system(),
        "platform": platform.platform(),
        "whoami": whoami.strip(),
        "username": (username or whoami.split("\\")[-1]).strip(),
        "home": str(home_path.resolve()),
        "documents": str(docs_path.resolve()) if docs_path.exists() else str(docs_path),
        "desktop": str(desktop_path.resolve()) if desktop_path.exists() else str(desktop_path),
        "cwd": str(Path(cwd).resolve()),
        "python": sys.executable,
    }
    return env


def environment_fingerprint(env: Mapping[str, Any]) -> str:
    payload = json.dumps(
        {k: env[k] for k in ("os", "username", "home", "documents", "desktop", "cwd") if k in env},
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def environment_facts(env: Mapping[str, Any]) -> list[str]:
    """Facts stored in AgentMemory (kind=fact) for path-aware hybrid runs."""
    username = str(env.get("username") or "").strip()
    home = str(env.get("home") or "").strip()
    documents = str(env.get("documents") or "").strip()
    desktop = str(env.get("desktop") or "").strip()
    cwd = str(env.get("cwd") or "").strip()
    os_name = str(env.get("os") or platform.system()).strip()
    facts = [
        f"Hybrid runner OS: {os_name}",
        f"Local shell username: {username}" if username else "Local shell username: (unknown)",
        f"Local home directory: {home}" if home else "Local home directory: (unknown)",
        f"Local Documents folder: {documents}" if documents else "Local Documents folder: (unknown)",
        f"Local Desktop folder: {desktop}" if desktop else "Local Desktop folder: (unknown)",
        f"Hybrid runner working directory: {cwd}" if cwd else "Hybrid runner working directory: (unknown)",
        (
            "When using file tools (s3_read_file, s3_write_file, s3_create_pdf, etc.), "
            f"always use these real paths — never placeholder paths like C:\\Users\\User\\..."
        ),
    ]
    if os_name == "Windows" and username:
        facts.append(
            f"On this PC the Windows profile is C:\\Users\\{username}, not C:\\Users\\User."
        )
    return facts


def format_environment_prompt(env: Mapping[str, Any]) -> str:
    lines = ["Local machine (hybrid runner — use these paths for all file tools):"]
    for key, label in (
        ("username", "Username"),
        ("home", "Home"),
        ("documents", "Documents"),
        ("desktop", "Desktop"),
        ("cwd", "Runner cwd"),
        ("os", "OS"),
    ):
        val = str(env.get(key) or "").strip()
        if val:
            lines.append(f"- {label}: {val}")
    lines.append(
        "Never invent placeholder paths (e.g. C:\\Users\\User\\Documents). "
        "Use the paths above."
    )
    lines.append(
        "Saving files (do this exactly):\n"
        "- When the user names a location (\"on my desktop\", \"in Documents\"), pass output_path "
        "built from the matching folder above — do NOT let it default elsewhere.\n"
        "- After a file tool returns, tell the user the EXACT full path it reported saving to. "
        "Never claim a location you didn't write to (e.g. don't say \"desktop\" if it saved to Documents).\n"
        "- These folders may be redirected into OneDrive, so the real path can contain \"OneDrive\". "
        "That is expected — report the actual path.\n"
        "- If the user says they can't find a file you already created, do NOT recreate it. "
        "Re-state the exact path from your previous result and note it may be inside the OneDrive-backed folder."
    )
    return "\n".join(lines)


def get_cached_environment() -> dict[str, Any] | None:
    return _CACHED


def configure_local_environment(env: dict[str, Any] | None) -> None:
    global _CACHED
    _CACHED = env


def resolve_local_path(raw: str, *, env: Mapping[str, Any] | None = None) -> Path:
    """Rewrite common placeholder paths to the probed home directory."""
    text = (raw or "").strip()
    if not text:
        return Path(text)

    ctx = env if env is not None else _CACHED
    if ctx:
        home = str(ctx.get("home") or "").strip()
        desktop = str(ctx.get("desktop") or "").strip()
        documents = str(ctx.get("documents") or "").strip()
        if home:
            normalized = text.replace("/", "\\")
            # Rewrite LLM placeholder profile paths on Windows hosts.
            if re.match(r"^[A-Za-z]:\\", normalized):
                home_norm = str(Path(home)).rstrip("\\")
                for placeholder in (r"C:\Users\User", r"C:\Users\user"):
                    if placeholder.lower() in normalized.lower():
                        idx = normalized.lower().find(placeholder.lower())
                        normalized = home_norm + normalized[idx + len(placeholder) :]
                        break
                text = normalized

        # Normalize any Desktop/Documents reference to the probed folder so the write
        # follows OneDrive / Known-Folder redirection and lands where the user actually
        # sees it. Covers a bare "Desktop", a "Desktop/report.xlsx" prefix, and an
        # absolute "<home>\Desktop\report.xlsx" that the model built ignoring redirection.
        rewritten = _rewrite_special_folder(text, home=home, desktop=desktop, documents=documents)
        if rewritten is not None:
            return rewritten

    return Path(text).expanduser()


def _rewrite_special_folder(
    text: str, *, home: str, desktop: str, documents: str
) -> Path | None:
    """Map a Desktop/Documents reference onto the probed (redirection-aware) folder.

    Windows Known-Folder redirection (e.g. OneDrive Backup) moves the real Desktop to
    ``C:\\Users\\me\\OneDrive\\Desktop``. A model that writes to ``C:\\Users\\me\\Desktop``
    or a bare ``Desktop/file.xlsx`` would land in a folder the user never sees. Rewriting
    every such reference to the probed path keeps files where the user looks.
    """
    norm = text.strip().replace("\\", "/")
    low = norm.lower()
    home_l = home.lower().replace("\\", "/").rstrip("/") if home else ""
    for name, probed in (("desktop", desktop), ("documents", documents)):
        if not probed:
            continue
        prefixes = [name, "~/" + name, "%userprofile%/" + name]
        if home_l:
            prefixes.append(home_l + "/" + name)
        for pre in prefixes:
            if low == pre or low == pre + "/":
                return Path(probed)
            if low.startswith(pre + "/"):
                rest = norm[len(pre) + 1 :].lstrip("/")
                return (Path(probed) / rest) if rest else Path(probed)
    return None


async def sync_local_environment_to_backend(
    http: Any,
    *,
    agent_id: str,
    headers: dict[str, str],
    log: Any | None = None,
) -> dict[str, Any]:
    """Probe once per fingerprint change and POST facts to agent memory."""
    global _SYNCED_FINGERPRINT

    env = probe_local_environment()
    configure_local_environment(env)
    fingerprint = environment_fingerprint(env)

    if fingerprint == _SYNCED_FINGERPRINT:
        return env

    facts = environment_facts(env)
    try:
        await http.post_json(
            f"/api/v1/agents/{agent_id}/local-environment",
            {"facts": facts, "fingerprint": fingerprint},
            headers=headers,
        )
        _SYNCED_FINGERPRINT = fingerprint
        if log:
            log(
                "local_environment_synced",
                username=env.get("username"),
                home=env.get("home"),
                documents=env.get("documents"),
            )
    except Exception as exc:
        if log:
            log("local_environment_sync_failed", error=str(exc))

    return env
