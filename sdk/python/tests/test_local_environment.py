from pathlib import Path

from qlix.local_environment import (
    configure_local_environment,
    environment_facts,
    environment_fingerprint,
    resolve_local_path,
)


def test_resolve_local_path_rewrites_windows_user_placeholder():
    configure_local_environment(
        {
            "os": "Windows",
            "username": "admin",
            "home": r"C:\Users\admin",
            "documents": r"C:\Users\admin\Documents",
        }
    )
    resolved = resolve_local_path(r"C:\Users\User\Documents\report.txt")
    assert resolved == Path(r"C:\Users\admin\Documents\report.txt")


def test_environment_facts_include_real_paths():
    env = {
        "os": "Windows",
        "username": "admin",
        "home": r"C:\Users\admin",
        "documents": r"C:\Users\admin\Documents",
        "cwd": r"C:\Projects\qlix",
    }
    facts = environment_facts(env)
    assert any("admin" in f for f in facts)
    assert any(r"C:\Users\admin" in f for f in facts)
    assert any("never placeholder" in f.lower() or "never invent" in f.lower() for f in facts)


def test_environment_fingerprint_stable():
    env = {"os": "Windows", "username": "admin", "home": "/home/admin", "documents": "/home/admin/Documents", "cwd": "/tmp"}
    assert environment_fingerprint(env) == environment_fingerprint(dict(env))
