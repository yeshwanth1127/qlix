"""Decorator-based registry for runtime discovery of pluggable components.

Adapted from IPW's ``src/ipw/core/registry.py``.  Each typed subclass gets its
own isolated storage so registrations in one registry never leak into another.
"""

from __future__ import annotations

import asyncio
import inspect
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, Dict, Generic, Iterator, Tuple, Type, TypeVar

if TYPE_CHECKING:
    from qlix.luna.agents._stubs import BaseAgent
    from qlix.luna.engine._stubs import InferenceEngine
    from qlix.luna.tools.storage._stubs import MemoryBackend

T = TypeVar("T")


class RegistryUnavailableError(RuntimeError):
    """Raised when a draining/inactive plugin is asked to accept new work."""


@dataclass(frozen=True, slots=True)
class RegistrationMetadata:
    owner_id: str = "core"
    plugin_kind: str = "core"
    version: str | None = None


@dataclass(slots=True)
class DisposableRegistration:
    registry: type["RegistryBase[Any]"]
    key: str
    owner_id: str

    def dispose(self) -> None:
        self.registry.unregister(self.key)


class RegistryBase(Generic[T]):
    """Generic registry base class with class-specific entry isolation."""

    @classmethod
    def _entries(cls) -> Dict[str, T]:
        attr_name = f"_registry_entries_{cls.__name__}"
        storage = getattr(cls, attr_name, None)
        if storage is None:
            storage: Dict[str, T] = {}
            setattr(cls, attr_name, storage)
        return storage

    @classmethod
    def _metadata(cls) -> Dict[str, RegistrationMetadata]:
        name = f"_registry_metadata_{cls.__name__}"
        storage = getattr(cls, name, None)
        if storage is None:
            storage = {}
            setattr(cls, name, storage)
        return storage

    @classmethod
    def _cleanups(cls) -> Dict[str, Callable[[T], Any]]:
        name = f"_registry_cleanups_{cls.__name__}"
        storage = getattr(cls, name, None)
        if storage is None:
            storage = {}
            setattr(cls, name, storage)
        return storage

    @classmethod
    def _owner_states(cls) -> Dict[str, str]:
        name = f"_registry_owner_states_{cls.__name__}"
        storage = getattr(cls, name, None)
        if storage is None:
            storage = {"core": "active"}
            setattr(cls, name, storage)
        return storage

    @classmethod
    def _lease_counts(cls) -> Dict[str, int]:
        name = f"_registry_lease_counts_{cls.__name__}"
        storage = getattr(cls, name, None)
        if storage is None:
            storage = {}
            setattr(cls, name, storage)
        return storage

    @classmethod
    def _condition(cls) -> threading.Condition:
        name = f"_registry_condition_{cls.__name__}"
        condition = getattr(cls, name, None)
        if condition is None:
            condition = threading.Condition()
            setattr(cls, name, condition)
        return condition

    @classmethod
    def register(
        cls,
        key: str,
        *,
        owner_id: str = "core",
        plugin_kind: str = "core",
        version: str | None = None,
        cleanup: Callable[[T], Any] | None = None,
    ) -> Callable[[T], T]:
        """Decorator that registers *entry* under *key*."""

        def decorator(entry: T) -> T:
            entries = cls._entries()
            if key in entries:
                raise ValueError(f"{cls.__name__} already has an entry for '{key}'")
            entries[key] = entry
            cls._metadata()[key] = RegistrationMetadata(owner_id, plugin_kind, version)
            cls._owner_states().setdefault(owner_id, "active")
            if cleanup is not None:
                cls._cleanups()[key] = cleanup
            return entry

        return decorator

    @classmethod
    def register_value(
        cls,
        key: str,
        value: T,
        *,
        owner_id: str = "core",
        plugin_kind: str = "core",
        version: str | None = None,
        cleanup: Callable[[T], Any] | None = None,
    ) -> T:
        """Imperatively register a *value* under *key*."""
        entries = cls._entries()
        if key in entries:
            raise ValueError(f"{cls.__name__} already has an entry for '{key}'")
        entries[key] = value
        cls._metadata()[key] = RegistrationMetadata(owner_id, plugin_kind, version)
        cls._owner_states().setdefault(owner_id, "active")
        if cleanup is not None:
            cls._cleanups()[key] = cleanup
        return value

    @classmethod
    def register_owned(
        cls,
        key: str,
        value: T,
        *,
        owner_id: str,
        plugin_kind: str,
        version: str | None = None,
        cleanup: Callable[[T], Any] | None = None,
    ) -> DisposableRegistration:
        cls.register_value(
            key,
            value,
            owner_id=owner_id,
            plugin_kind=plugin_kind,
            version=version,
            cleanup=cleanup,
        )
        return DisposableRegistration(cls, key, owner_id)

    @classmethod
    def get(cls, key: str) -> T:
        """Retrieve the entry for *key*, raising ``KeyError`` if missing."""
        try:
            entry = cls._entries()[key]
        except KeyError as exc:
            raise KeyError(
                f"{cls.__name__} does not have an entry for '{key}'"
            ) from exc
        metadata = cls._metadata().get(key, RegistrationMetadata())
        state = cls._owner_states().get(metadata.owner_id, "active")
        if state != "active":
            raise RegistryUnavailableError(
                f"{cls.__name__} entry '{key}' is owned by {metadata.owner_id!r} ({state})"
            )
        return entry

    @classmethod
    def metadata(cls, key: str) -> RegistrationMetadata:
        if key not in cls._entries():
            raise KeyError(f"{cls.__name__} does not have an entry for '{key}'")
        return cls._metadata().get(key, RegistrationMetadata())

    @classmethod
    @contextmanager
    def lease(cls, key: str) -> Iterator[T]:
        entry = cls.get(key)
        owner_id = cls.metadata(key).owner_id
        condition = cls._condition()
        with condition:
            cls._lease_counts()[owner_id] = cls._lease_counts().get(owner_id, 0) + 1
        try:
            yield entry
        finally:
            with condition:
                remaining = max(0, cls._lease_counts().get(owner_id, 1) - 1)
                if remaining:
                    cls._lease_counts()[owner_id] = remaining
                else:
                    cls._lease_counts().pop(owner_id, None)
                    condition.notify_all()

    @classmethod
    def create(cls, key: str, *args: Any, **kwargs: Any) -> Any:
        """Look up *key* and instantiate it with the given arguments."""
        entry = cls.get(key)
        if not callable(entry):
            raise TypeError(
                f"{cls.__name__} entry '{key}' is not callable"
                " and cannot be instantiated"
            )
        return entry(*args, **kwargs)

    @classmethod
    def items(cls) -> Tuple[Tuple[str, T], ...]:
        """Return all ``(key, entry)`` pairs as a tuple."""
        return tuple(cls._entries().items())

    @classmethod
    def keys(cls) -> Tuple[str, ...]:
        """Return all registered keys as a tuple."""
        return tuple(cls._entries().keys())

    @classmethod
    def contains(cls, key: str) -> bool:
        """Check whether *key* is registered."""
        if key not in cls._entries():
            return False
        owner_id = cls._metadata().get(key, RegistrationMetadata()).owner_id
        return cls._owner_states().get(owner_id, "active") == "active"

    @classmethod
    def unregister(cls, key: str) -> bool:
        entry = cls._entries().pop(key, None)
        if entry is None:
            return False
        cleanup = cls._cleanups().pop(key, None)
        cls._metadata().pop(key, None)
        if cleanup is not None:
            result = cleanup(entry)
            if inspect.isawaitable(result):
                try:
                    asyncio.get_running_loop().create_task(result)
                except RuntimeError:
                    asyncio.run(result)
        return True

    @classmethod
    def deactivate_owner(
        cls,
        owner_id: str,
        *,
        timeout: float = 30.0,
        remove: bool = True,
    ) -> None:
        cls._owner_states()[owner_id] = "draining"
        condition = cls._condition()
        deadline = time.monotonic() + max(0.01, timeout)
        with condition:
            while cls._lease_counts().get(owner_id, 0) > 0:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f"Timed out draining registry owner {owner_id!r}")
                condition.wait(remaining)
        cls._owner_states()[owner_id] = "inactive"
        if remove:
            cls.unregister_owner(owner_id)

    @classmethod
    def unregister_owner(cls, owner_id: str) -> None:
        keys = [key for key, meta in cls._metadata().items() if meta.owner_id == owner_id]
        for key in keys:
            cls.unregister(key)

    @classmethod
    def activate_owner(cls, owner_id: str) -> None:
        cls._owner_states()[owner_id] = "active"

    @classmethod
    def clear(cls) -> None:
        """Remove all entries (useful in tests)."""
        cls._entries().clear()
        cls._metadata().clear()
        cls._cleanups().clear()
        cls._owner_states().clear()
        cls._owner_states()["core"] = "active"
        cls._lease_counts().clear()


# ---------------------------------------------------------------------------
# Typed subclass registries — one per primitive
# ---------------------------------------------------------------------------


class ModelRegistry(RegistryBase[Any]):
    """Registry for ``ModelSpec`` objects."""


class EngineRegistry(RegistryBase[Type["InferenceEngine"]]):
    """Registry for inference engine backends."""


class MemoryRegistry(RegistryBase[Type["MemoryBackend"]]):
    """Registry for memory / retrieval backends."""


class AgentRegistry(RegistryBase[Type["BaseAgent"]]):
    """Registry for agent implementations."""


class ToolRegistry(RegistryBase[Any]):
    """Registry for tool specifications."""


class RouterPolicyRegistry(RegistryBase[Any]):
    """Registry for router policy implementations."""


class BenchmarkRegistry(RegistryBase[Any]):
    """Registry for benchmark implementations."""


class ChannelRegistry(RegistryBase[Any]):
    """Registry for channel implementations."""


class LearningRegistry(RegistryBase[Any]):
    """Registry for learning policies."""


class SkillRegistry(RegistryBase[Any]):
    """Registry for skill manifests."""


class SpeechRegistry(RegistryBase[Any]):
    """Registry for speech backend implementations."""


class CompressionRegistry(RegistryBase[Any]):
    """Registry for context compression strategies."""


class TTSRegistry(RegistryBase[Any]):
    """Registry for text-to-speech backend implementations."""


class ConnectorRegistry(RegistryBase[Any]):
    """Registry for data source connectors (Gmail, Slack, etc.)."""


__all__ = [
    "AgentRegistry",
    "BenchmarkRegistry",
    "ChannelRegistry",
    "CompressionRegistry",
    "ConnectorRegistry",
    "EngineRegistry",
    "LearningRegistry",
    "MemoryRegistry",
    "ModelRegistry",
    "DisposableRegistration",
    "RegistrationMetadata",
    "RegistryUnavailableError",
    "RegistryBase",
    "RouterPolicyRegistry",
    "SkillRegistry",
    "SpeechRegistry",
    "TTSRegistry",
    "ToolRegistry",
]
