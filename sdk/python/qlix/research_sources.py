"""Registry of research-source credential wiring (see research_sources.json).

This is the single source of truth for how each research source (YouTube,
Twitter, Reddit, Xiaohongshu, …) receives its platform-wide credentials on a
cloud runner. It is pure data + helpers: the actual side effects (copying files,
running configure commands, routing searches) live in cloud_research_runtime so
this module stays free of imports that would create a cycle.

The backend provisioner reads the same JSON to decide which secret files to
bind-mount and which env vars to forward (backend/src/cloudRunners/
platformResearchSecrets.ts).
"""

from __future__ import annotations

import json
import os
from typing import Any

_REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "research_sources.json")


def _load() -> dict[str, Any]:
    try:
        with open(_REGISTRY_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


_REGISTRY: dict[str, Any] = _load()

SOURCES: list[dict[str, Any]] = list(_REGISTRY.get("sources") or [])
SOURCES_BY_ID: dict[str, dict[str, Any]] = {
    str(s.get("id")): s for s in SOURCES if s.get("id")
}
GLOBAL_PASSTHROUGH_ENV: list[str] = list(_REGISTRY.get("global_passthrough_env") or [])
GLOBAL_CONFIGURE: list[dict[str, Any]] = list(_REGISTRY.get("global_configure") or [])


def all_passthrough_env() -> list[str]:
    """Every env var any source (or the global block) forwards into the runner."""
    keys: list[str] = list(GLOBAL_PASSTHROUGH_ENV)
    for src in SOURCES:
        for key in src.get("passthrough_env") or []:
            keys.append(str(key))
    # Preserve order, drop dupes.
    seen: set[str] = set()
    out: list[str] = []
    for key in keys:
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def render_command(template: list[str], env: dict[str, str]) -> list[str] | None:
    """Substitute {ENV_VAR} placeholders from `env`; None if any value missing."""
    rendered: list[str] = []
    for token in template:
        out = str(token)
        for key, val in env.items():
            placeholder = "{" + key + "}"
            if placeholder in out:
                if not val:
                    return None
                out = out.replace(placeholder, val)
        if "{" in out and "}" in out:
            # An unresolved {PLACEHOLDER} means a required value was absent.
            return None
        rendered.append(out)
    return rendered


def render_search(template: list[str], *, query: str, limit: int) -> list[str]:
    """Substitute {query}/{limit} for a social-search command (no shell)."""
    out: list[str] = []
    for token in template:
        out.append(str(token).replace("{query}", query).replace("{limit}", str(limit)))
    return out
