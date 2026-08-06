"""Per-run hybrid working directory (Hermes-style session cwd).

File tools resolve relative paths against this cwd. Shell commands run with it
as the process working directory. Reset between runs.
"""

from __future__ import annotations

import contextvars
from pathlib import Path

from .local_environment import get_cached_environment

_session_cwd: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "qlix_hybrid_cwd", default=None
)


def default_cwd() -> Path:
    env = get_cached_environment() or {}
    raw = str(env.get("cwd") or "").strip()
    if raw:
        p = Path(raw).expanduser()
        if p.is_dir():
            return p.resolve()
    return Path.cwd().resolve()


def get_cwd() -> Path:
    current = _session_cwd.get()
    if current:
        p = Path(current)
        if p.is_dir():
            return p.resolve()
    return default_cwd()


def set_cwd(path: str | Path) -> Path:
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = (get_cwd() / p).resolve()
    else:
        p = p.resolve()
    if not p.is_dir():
        raise NotADirectoryError(f"Not a directory: {p}")
    _session_cwd.set(str(p))
    return p


def reset_cwd() -> None:
    _session_cwd.set(None)


def resolve_against_cwd(raw: str) -> Path:
    """Resolve a user/model path against the session cwd when relative."""
    text = (raw or "").strip()
    if not text or text in (".", "./"):
        return get_cwd()
    p = Path(text).expanduser()
    if not p.is_absolute():
        p = get_cwd() / p
    return p


def cwd_prompt_line() -> str:
    return f"Current working directory (hybrid session cwd): {get_cwd()}"
