"""Runtime helpers for the embedded SDK path.

These were originally defined in the (now-removed) ``cli.ask`` module.
The SDK runtime imports them from here so the trimmed package no longer
depends on the CLI layer.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


_MEMORY_TOOLS = frozenset(
    {"retrieval", "memory_store", "memory_search", "memory_index", "memory_retrieve"}
)


def _get_memory_backend(config):
    """Try to instantiate the memory backend.

    Returns ``None`` on failure and logs at DEBUG. Callers that *require*
    the backend should warn loudly themselves.
    """
    try:
        import qlix.luna.tools.storage  # noqa: F401
        from qlix.luna.core.registry import MemoryRegistry

        key = config.memory.default_backend
        if not MemoryRegistry.contains(key):
            return None

        if key == "sqlite":
            return MemoryRegistry.create(key, db_path=config.memory.db_path)
        return MemoryRegistry.create(key)
    except Exception as exc:
        logger.debug("Memory backend unavailable (optional): %s", exc)
        return None


def _build_tools(
    tool_names,
    config,
    engine,
    model_name: str,
    *,
    channel=None,
):
    """Instantiate tool objects from names. ``channel`` accepted but ignored
    in the SDK build (channel integrations are server-side only).
    """
    from qlix.luna.core.registry import ToolRegistry

    tools = []
    for raw in tool_names:
        name = raw.strip()
        if not name or not ToolRegistry.contains(name):
            continue
        tool_cls = ToolRegistry.get(name)
        if name in _MEMORY_TOOLS:
            backend = _get_memory_backend(config)
            if backend is None:
                logger.warning(
                    "Tool %r requested but no memory backend available "
                    "(default=%r).",
                    name,
                    getattr(config.memory, "default_backend", "?"),
                )
            tools.append(tool_cls(backend=backend))
        elif name == "llm":
            tools.append(tool_cls(engine=engine, model=model_name))
        else:
            tools.append(tool_cls())
    return tools
