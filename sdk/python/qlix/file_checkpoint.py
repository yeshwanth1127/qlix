"""Filesystem checkpoints for hybrid mutations (pre-V4A / rollback)."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Iterable


def _safe_key(path: Path) -> str:
    """Map an absolute path to a single checkpoint filename segment."""
    try:
        resolved = str(path.resolve())
    except OSError:
        resolved = str(path)
    # Keep readable but filesystem-safe
    key = resolved.replace("\\", "/").lstrip("/")
    key = re.sub(r"[^\w.\-/=+]", "_", key)
    key = key.replace("/", "__")
    return key[:240] or "empty"


def checkpoint_root(run_id: str | None = None) -> Path:
    rid = (run_id or "anonymous").strip() or "anonymous"
    rid = re.sub(r"[^\w.\-]", "_", rid)[:80]
    return Path.home() / ".qlix" / "checkpoints" / rid


def snapshot_paths(
    paths: Iterable[str | Path],
    *,
    run_id: str | None = None,
) -> Path:
    """Copy existing target files into ~/.qlix/checkpoints/<run_id>/.

    Missing paths are skipped (ADD targets). Returns the checkpoint directory.
    """
    root = checkpoint_root(run_id)
    root.mkdir(parents=True, exist_ok=True)
    for raw in paths:
        p = Path(raw)
        try:
            if not p.is_file():
                continue
        except OSError:
            continue
        dest = root / _safe_key(p)
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dest)
            # Sidecar records original absolute path for restore
            Path(str(dest) + ".path").write_text(str(p.resolve()), encoding="utf-8")
        except OSError:
            continue
    return root


def restore_checkpoint(checkpoint_dir: Path) -> list[str]:
    """Restore files from a checkpoint directory. Returns restored absolute paths."""
    restored: list[str] = []
    if not checkpoint_dir.is_dir():
        return restored
    for path_meta in checkpoint_dir.glob("*.path"):
        try:
            original = Path(path_meta.read_text(encoding="utf-8").strip())
            snap = path_meta.with_suffix("")  # strip .path → snap file
            # with_suffix("") on "foo.txt.path" may not work as intended;
            # path_meta is like "key.path", snap is same stem without .path
            snap = Path(str(path_meta)[: -len(".path")])
            if not snap.is_file():
                continue
            original.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(snap, original)
            restored.append(str(original))
        except OSError:
            continue
    return restored
