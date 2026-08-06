"""Tests for Hermes-level V4A multi-file patch (hybrid)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from qlix.file_checkpoint import restore_checkpoint, snapshot_paths
from qlix.file_read_state import clear_read_state, note_file_read, stale_read_warning
from qlix.fuzzy_match import fuzzy_find_and_replace
from qlix.hybrid_cwd import set_cwd
from qlix.hybrid_file_ops import apply_replace_patch, apply_v4a_patch, sensitive_path_blocked
from qlix.v4a_parser import OperationType, parse_v4a_patch


@pytest.fixture()
def project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    clear_read_state()
    set_cwd(str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    return tmp_path


def test_parse_add_update_delete_move():
    patch = """\
*** Begin Patch
*** Add File: src/main.py
+def main():
+    print("hi")
*** Update File: README.md
@@
-# Old
+# New
*** Delete File: legacy.py
*** Move File: a.py -> b.py
*** End Patch
"""
    ops, err = parse_v4a_patch(patch)
    assert err is None
    assert [o.operation for o in ops] == [
        OperationType.ADD,
        OperationType.UPDATE,
        OperationType.DELETE,
        OperationType.MOVE,
    ]
    assert ops[0].file_path == "src/main.py"
    assert ops[3].new_path == "b.py"
    assert any(l.prefix == "+" for h in ops[0].hunks for l in h.lines)


def test_atomic_abort_when_update_hunk_fails(project: Path):
    (project / "good.txt").write_text("hello\n", encoding="utf-8")
    (project / "bad.txt").write_text("unchanged\n", encoding="utf-8")
    patch = """\
*** Begin Patch
*** Update File: good.txt
@@
-hello
+hello world
*** Update File: bad.txt
@@
-does not exist
+oops
*** End Patch
"""
    result = json.loads(apply_v4a_patch(patch, run_id="t1"))
    assert result["ok"] is False
    assert "validation failed" in (result.get("error") or "").lower()
    assert (project / "good.txt").read_text(encoding="utf-8") == "hello\n"
    assert (project / "bad.txt").read_text(encoding="utf-8") == "unchanged\n"


def test_fuzzy_match_recovers_whitespace_drift():
    content = "def foo():\n    return 1\n"
    old = "def foo():\n  return 1"  # 2-space indent vs file's 4
    new = "def foo():\n    return 2"
    updated, count, strategy, err = fuzzy_find_and_replace(content, old, new)
    assert err is None
    assert count == 1
    assert strategy is not None
    assert "return 2" in updated


def test_sensitive_path_and_traversal_rejected(project: Path):
    assert sensitive_path_blocked(Path("/etc/passwd")) is not None
    result = json.loads(
        apply_v4a_patch(
            "*** Begin Patch\n*** Add File: ../../etc/evil\n+x\n*** End Patch\n",
            run_id="t2",
        )
    )
    assert result["ok"] is False
    assert "traversal" in (result.get("error") or "").lower()


def test_replace_mode_still_works(project: Path):
    f = project / "x.py"
    f.write_text("a = 1\n", encoding="utf-8")
    out = json.loads(
        apply_replace_patch(path="x.py", old_string="a = 1", new_string="a = 2", run_id="t3")
    )
    assert out["ok"] is True
    assert out["mode"] == "replace"
    assert out["replacements"] == 1
    assert f.read_text(encoding="utf-8") == "a = 2\n"


def test_v4a_multi_file_apply(project: Path):
    (project / "README.md").write_text("# Old\n", encoding="utf-8")
    (project / "legacy.py").write_text("print(1)\n", encoding="utf-8")
    (project / "a.py").write_text("x\n", encoding="utf-8")
    patch = """\
*** Begin Patch
*** Add File: src/main.py
+def main():
+    print("hi")
*** Update File: README.md
@@
-# Old
+# New
*** Delete File: legacy.py
*** Move File: a.py -> b.py
*** End Patch
"""
    result = json.loads(apply_v4a_patch(patch, run_id="t4"))
    assert result["ok"] is True, result
    assert (project / "src" / "main.py").is_file()
    assert (project / "README.md").read_text(encoding="utf-8") == "# New\n"
    assert not (project / "legacy.py").exists()
    assert (project / "b.py").read_text(encoding="utf-8") == "x\n"
    assert "src/main.py" in result["files_created"]


def test_checkpoint_restores_on_mid_apply_failure(project: Path, monkeypatch: pytest.MonkeyPatch):
    target = project / "keep.txt"
    target.write_text("original\n", encoding="utf-8")
    cp = snapshot_paths([target], run_id="ckpt1")
    target.write_text("corrupted\n", encoding="utf-8")
    restored = restore_checkpoint(cp)
    assert str(target.resolve()) in restored
    assert target.read_text(encoding="utf-8") == "original\n"


def test_stale_read_warning(project: Path):
    f = project / "s.txt"
    f.write_text("v1\n", encoding="utf-8")
    assert stale_read_warning(f) is not None  # never read
    note_file_read(f)
    assert stale_read_warning(f) is None
    # bump mtime
    os.utime(f, (f.stat().st_mtime + 10, f.stat().st_mtime + 10))
    assert stale_read_warning(f) is not None


def test_tool_schema_exposes_mode_enum():
    from qlix.agents3_runtime import openai_agents3_tool_definitions
    from qlix.identity import AgentIdentity

    identity = AgentIdentity(
        did="did:t:1",
        agent_id="a1",
        private_key_hex="0" * 64,
        public_key_hex="1" * 64,
        permission_scopes=("system.file_read", "system.file_write"),
        jit_scopes=("system.file_write",),
        always_scopes=(),
        backend_url="http://localhost",
        llm_mode="proxy",
        raw={},
    )
    tools = openai_agents3_tool_definitions(identity, groups=("files", "code"))
    patch_tool = next(
        t for t in tools if t.get("function", {}).get("name") == "luna_local_patch"
    )
    props = patch_tool["function"]["parameters"]["properties"]
    assert props["mode"]["enum"] == ["replace", "patch"]
    assert "patch" in props
