"""Hybrid file patch + search (Hermes-inspired, Qlix native I/O).

Implements:
- replace-mode patch (old_string → new_string)
- V4A multi-file patch (Add/Update/Delete/Move)
- content / filename search (rg when available, Python fallback)
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .hybrid_cwd import resolve_against_cwd


def apply_replace_patch(
    *,
    path: str,
    old_string: str,
    new_string: str,
    replace_all: bool = False,
    run_id: str | None = None,
) -> str:
    target = resolve_against_cwd(path)
    blocked = sensitive_path_blocked(target)
    if blocked:
        return f"[failed] {blocked}"
    if not target.is_file():
        return f"[failed] File not found: {target}"
    try:
        text = target.read_text(encoding="utf-8")
    except OSError as exc:
        return f"[failed] Cannot read {target}: {exc}"

    if old_string == "":
        return "[failed] old_string must not be empty — use luna_local_write_file for full rewrites"
    count = text.count(old_string)
    if count == 0:
        return (
            f"[failed] old_string not found in {target}. "
            "Re-read the file and copy the exact text to replace."
        )
    if count > 1 and not replace_all:
        return (
            f"[failed] old_string found {count} times in {target}. "
            "Pass replace_all=true or include more surrounding context."
        )
    if replace_all:
        updated = text.replace(old_string, new_string)
        n = count
    else:
        updated = text.replace(old_string, new_string, 1)
        n = 1

    from .file_checkpoint import snapshot_paths
    from .file_read_state import stale_read_warning

    warnings: list[str] = []
    warn = stale_read_warning(target)
    if warn:
        warnings.append(warn)
    snapshot_paths([target], run_id=run_id)

    try:
        target.write_text(updated, encoding="utf-8")
    except OSError as exc:
        return f"[failed] Cannot write {target}: {exc}"
    return json.dumps(
        {
            "ok": True,
            "mode": "replace",
            "path": str(target.resolve()),
            "replacements": n,
            "bytes": len(updated.encode("utf-8")),
            "warnings": warnings,
        },
        ensure_ascii=False,
    )


def _reject_traversal(raw: str) -> str | None:
    if ".." in Path(raw).parts or ".." in raw.replace("\\", "/").split("/"):
        return f"Path traversal rejected: {raw}"
    return None


@dataclass
class _FileOpResult:
    error: str | None = None
    content: str = ""


class HostFileOps:
    """Filesystem adapter for v4a_parser.apply_v4a_operations."""

    def read_file_raw(self, path: str) -> _FileOpResult:
        target = resolve_against_cwd(path)
        if not target.is_file():
            return _FileOpResult(error=f"File not found: {target}")
        try:
            return _FileOpResult(content=target.read_text(encoding="utf-8"))
        except OSError as exc:
            return _FileOpResult(error=str(exc))

    def write_file(self, path: str, content: str) -> _FileOpResult:
        target = resolve_against_cwd(path)
        blocked = sensitive_path_blocked(target)
        if blocked:
            return _FileOpResult(error=blocked)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            return _FileOpResult()
        except OSError as exc:
            return _FileOpResult(error=str(exc))

    def delete_file(self, path: str) -> _FileOpResult:
        target = resolve_against_cwd(path)
        blocked = sensitive_path_blocked(target)
        if blocked:
            return _FileOpResult(error=blocked)
        try:
            if not target.is_file():
                return _FileOpResult(error=f"File not found: {target}")
            target.unlink()
            return _FileOpResult()
        except OSError as exc:
            return _FileOpResult(error=str(exc))

    def move_file(self, src: str, dst: str) -> _FileOpResult:
        source = resolve_against_cwd(src)
        dest = resolve_against_cwd(dst)
        for p in (source, dest):
            blocked = sensitive_path_blocked(p)
            if blocked:
                return _FileOpResult(error=blocked)
        try:
            if not source.is_file():
                return _FileOpResult(error=f"Source not found: {source}")
            if dest.exists():
                return _FileOpResult(error=f"Destination exists: {dest}")
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(dest))
            return _FileOpResult()
        except OSError as exc:
            return _FileOpResult(error=str(exc))


def apply_v4a_patch(patch: str, *, run_id: str | None = None) -> str:
    """Parse + validate-then-apply a V4A multi-file patch. Returns JSON string."""
    from .file_checkpoint import restore_checkpoint, snapshot_paths
    from .file_read_state import stale_read_warning
    from .v4a_parser import (
        collect_v4a_paths,
        parse_v4a_patch,
        apply_v4a_operations,
    )

    if not (patch or "").strip():
        return json.dumps(
            {"ok": False, "mode": "patch", "error": "patch body is empty"},
            ensure_ascii=False,
        )

    operations, parse_error = parse_v4a_patch(patch)
    if parse_error:
        return json.dumps(
            {"ok": False, "mode": "patch", "error": parse_error},
            ensure_ascii=False,
        )
    if not operations:
        return json.dumps(
            {"ok": False, "mode": "patch", "error": "Patch contained no operations"},
            ensure_ascii=False,
        )

    warnings: list[str] = []
    resolved_targets: list[Path] = []
    for raw in collect_v4a_paths(operations):
        trav = _reject_traversal(raw)
        if trav:
            return json.dumps(
                {"ok": False, "mode": "patch", "error": trav},
                ensure_ascii=False,
            )
        target = resolve_against_cwd(raw)
        blocked = sensitive_path_blocked(target)
        if blocked:
            return json.dumps(
                {"ok": False, "mode": "patch", "error": blocked},
                ensure_ascii=False,
            )
        resolved_targets.append(target)
        warn = stale_read_warning(target)
        if warn:
            warnings.append(warn)

    checkpoint_dir = snapshot_paths(resolved_targets, run_id=run_id)
    result = apply_v4a_operations(operations, HostFileOps())

    if not result.success and (
        result.files_modified or result.files_created or result.files_deleted or result.files_moved
    ):
        restored = restore_checkpoint(checkpoint_dir)
        extra = (
            f" Restored {len(restored)} file(s) from checkpoint."
            if restored
            else " Checkpoint restore found nothing to restore — state may be inconsistent."
        )
        err = (result.error or "Apply failed") + extra
        return json.dumps(
            {
                "ok": False,
                "mode": "patch",
                "error": err,
                "files_modified": result.files_modified,
                "files_created": result.files_created,
                "files_deleted": result.files_deleted,
                "files_moved": result.files_moved,
                "warnings": warnings,
            },
            ensure_ascii=False,
        )

    if not result.success:
        return json.dumps(
            {
                "ok": False,
                "mode": "patch",
                "error": result.error,
                "warnings": warnings,
            },
            ensure_ascii=False,
        )

    return json.dumps(
        {
            "ok": True,
            "mode": "patch",
            "files_modified": result.files_modified,
            "files_created": result.files_created,
            "files_deleted": result.files_deleted,
            "files_moved": result.files_moved,
            "warnings": warnings,
        },
        ensure_ascii=False,
    )


def search_files(
    *,
    pattern: str,
    target: str = "content",
    path: str = ".",
    file_glob: str | None = None,
    limit: int = 50,
    offset: int = 0,
    output_mode: str = "content",
    context: int = 0,
) -> str:
    root = resolve_against_cwd(path)
    if not root.exists():
        return f"[failed] Path not found: {root}"
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    context = max(0, min(int(context or 0), 5))
    mode = (target or "content").strip().lower()
    if mode in ("find", "files"):
        return _search_by_name(root, pattern, limit=limit, offset=offset)
    return _search_content(
        root,
        pattern,
        file_glob=file_glob,
        limit=limit,
        offset=offset,
        output_mode=output_mode or "content",
        context=context,
    )


def _search_by_name(root: Path, pattern: str, *, limit: int, offset: int) -> str:
    glob_pat = pattern.strip() or "*"
    matches: list[tuple[float, str]] = []
    try:
        iterator = root.rglob(glob_pat) if root.is_dir() else [root]
        for p in iterator:
            if not p.is_file():
                continue
            try:
                mtime = p.stat().st_mtime
            except OSError:
                mtime = 0.0
            matches.append((mtime, str(p.resolve())))
    except OSError as exc:
        return f"[failed] search error: {exc}"
    matches.sort(key=lambda x: x[0], reverse=True)
    sliced = matches[offset : offset + limit]
    lines = [path for _, path in sliced]
    footer = ""
    if offset + limit < len(matches):
        footer = f"\n\n[Hint: truncated. Use offset={offset + limit} for more.]"
    return ("\n".join(lines) if lines else "(no files matched)") + footer


def _search_content(
    root: Path,
    pattern: str,
    *,
    file_glob: str | None,
    limit: int,
    offset: int,
    output_mode: str,
    context: int,
) -> str:
    rg = shutil.which("rg")
    if rg:
        return _search_content_rg(
            rg,
            root,
            pattern,
            file_glob=file_glob,
            limit=limit,
            offset=offset,
            output_mode=output_mode,
            context=context,
        )
    return _search_content_python(
        root,
        pattern,
        file_glob=file_glob,
        limit=limit,
        offset=offset,
        output_mode=output_mode,
        context=context,
    )


def _search_content_rg(
    rg: str,
    root: Path,
    pattern: str,
    *,
    file_glob: str | None,
    limit: int,
    offset: int,
    output_mode: str,
    context: int,
) -> str:
    cmd = [rg, "--line-number", "--color", "never", "--no-heading"]
    if output_mode == "files_only":
        cmd = [rg, "-l", "--color", "never"]
    elif output_mode == "count":
        cmd = [rg, "-c", "--color", "never"]
    elif context > 0:
        cmd.extend(["-C", str(context)])
    if file_glob:
        cmd.extend(["--glob", file_glob])
    cmd.extend(["--", pattern, str(root)])
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (subprocess.TimeoutExpired, OSError) as exc:
        return f"[failed] rg error: {exc}"
    # rg exits 1 when no matches
    text = proc.stdout or ""
    if proc.returncode not in (0, 1):
        err = (proc.stderr or "").strip()
        return f"[failed] rg failed: {err or proc.returncode}"
    lines = text.splitlines()
    sliced = lines[offset : offset + limit]
    footer = ""
    if offset + limit < len(lines):
        footer = f"\n\n[Hint: truncated. Use offset={offset + limit} for more.]"
    return ("\n".join(sliced) if sliced else "(no matches)") + footer


def _search_content_python(
    root: Path,
    pattern: str,
    *,
    file_glob: str | None,
    limit: int,
    offset: int,
    output_mode: str,
    context: int,
) -> str:
    try:
        regex = re.compile(pattern)
    except re.error as exc:
        return f"[failed] invalid regex: {exc}"

    files: list[Path] = []
    if root.is_file():
        files = [root]
    else:
        globber = file_glob or "*"
        try:
            files = [p for p in root.rglob(globber) if p.is_file()]
        except OSError as exc:
            return f"[failed] search error: {exc}"

    results: list[str] = []
    counts: dict[str, int] = {}
    files_hit: list[str] = []
    skipped = 0

    for fp in files:
        if len(results) >= limit + offset and output_mode == "content":
            break
        try:
            if fp.stat().st_size > 2_000_000:
                continue
            text = fp.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lines = text.splitlines()
        file_matches = 0
        for i, line in enumerate(lines):
            if not regex.search(line):
                continue
            file_matches += 1
            if output_mode == "content":
                if skipped < offset:
                    skipped += 1
                    continue
                if len(results) >= limit:
                    continue
                if context > 0:
                    start = max(0, i - context)
                    end = min(len(lines), i + context + 1)
                    chunk = []
                    for j in range(start, end):
                        prefix = ">" if j == i else " "
                        chunk.append(f"{fp}:{j + 1}:{prefix}{lines[j]}")
                    results.append("\n".join(chunk))
                else:
                    results.append(f"{fp}:{i + 1}:{line}")
        if file_matches:
            key = str(fp.resolve())
            counts[key] = file_matches
            files_hit.append(key)

    if output_mode == "files_only":
        sliced = files_hit[offset : offset + limit]
        return "\n".join(sliced) if sliced else "(no matches)"
    if output_mode == "count":
        items = list(counts.items())[offset : offset + limit]
        return "\n".join(f"{p}:{n}" for p, n in items) if items else "(no matches)"
    footer = ""
    # rough truncation hint
    if len(results) >= limit:
        footer = f"\n\n[Hint: truncated at {limit}. Narrow pattern or raise limit.]"
    return ("\n".join(results) if results else "(no matches)") + footer


def sensitive_path_blocked(path: Path) -> str | None:
    """Block writes into obvious sensitive system locations."""
    try:
        resolved = str(path.resolve()).replace("\\", "/").lower()
    except OSError:
        resolved = str(path).replace("\\", "/").lower()
    blocked_prefixes = (
        "/etc/",
        "/usr/",
        "/bin/",
        "/sbin/",
        "/boot/",
        "/dev/",
        "/proc/",
        "/sys/",
        "c:/windows/",
        "c:/program files/",
        "c:/program files (x86)/",
    )
    for pre in blocked_prefixes:
        if resolved.startswith(pre):
            return f"Refusing to modify sensitive path: {path}"
    home = Path.home()
    ssh = home / ".ssh"
    try:
        resolved_path = path.resolve()
        ssh_resolved = ssh.resolve()
        try:
            if resolved_path.is_relative_to(ssh_resolved):
                return f"Refusing to modify SSH keys: {path}"
        except AttributeError:
            # Python < 3.9
            if str(resolved_path).startswith(str(ssh_resolved)):
                return f"Refusing to modify SSH keys: {path}"
    except (OSError, ValueError):
        pass
    return None
