"""Lightweight per-process file read mtime tracking for soft stale-read warnings."""

from __future__ import annotations

from pathlib import Path

# path (resolved str) -> mtime at last successful read
_READ_MTIMES: dict[str, float] = {}


def _key(path: Path) -> str:
    try:
        return str(path.resolve())
    except OSError:
        return str(path)


def note_file_read(path: str | Path) -> None:
    p = Path(path)
    try:
        if not p.is_file():
            return
        _READ_MTIMES[_key(p)] = p.stat().st_mtime
    except OSError:
        return


def stale_read_warning(path: str | Path) -> str | None:
    """Non-blocking warning if path was never read or changed since last read."""
    p = Path(path)
    key = _key(p)
    try:
        if not p.exists():
            return None  # ADD targets — no stale concern
        mtime = p.stat().st_mtime
    except OSError:
        return None

    last = _READ_MTIMES.get(key)
    if last is None:
        return (
            f"{p}: not read in this session before patch — "
            "prefer luna_local_read_file first for accurate context"
        )
    if mtime > last + 1e-6:
        return (
            f"{p}: modified since last read (mtime changed) — "
            "re-read before patching if edits look wrong"
        )
    return None


def clear_read_state() -> None:
    """Test helper."""
    _READ_MTIMES.clear()
