"""Lifecycle manager for Luna tools, engines, connectors, skills, and resources."""

from __future__ import annotations

import asyncio
import importlib.util
import inspect
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Mapping

from qlix.luna.core.registry import DisposableRegistration, RegistryBase


class PluginValidationError(ValueError):
    """A plugin cannot activate because a dependency or setting is missing."""


class PluginUnavailableError(RuntimeError):
    """A plugin is inactive or draining and cannot accept new work."""


@dataclass(frozen=True, slots=True)
class PluginDependencies:
    python_modules: tuple[str, ...] = ()
    environment: tuple[str, ...] = ()
    config_keys: tuple[str, ...] = ()
    plugins: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RegistryBinding:
    registry: type[RegistryBase[Any]]
    key: str
    value: Any
    kind: str
    cleanup: Callable[[Any], Any] | None = None


ActivateHook = Callable[[Mapping[str, Any]], Any | Awaitable[Any]]


@dataclass(frozen=True, slots=True)
class LunaPluginManifest:
    plugin_id: str
    version: str = "1"
    dependencies: PluginDependencies = field(default_factory=PluginDependencies)
    registrations: tuple[RegistryBinding, ...] = ()
    activate: ActivateHook | None = None


@dataclass(slots=True)
class _Runtime:
    manifest: LunaPluginManifest
    state: str = "registered"
    registrations: list[DisposableRegistration] = field(default_factory=list)
    resources: list[Any] = field(default_factory=list)
    active_leases: int = 0
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)


class LunaPluginManager:
    """Validates, activates, drains, and completely removes one plugin's footprint."""

    def __init__(self) -> None:
        self._plugins: dict[str, _Runtime] = {}

    def register(self, manifest: LunaPluginManifest) -> None:
        if not manifest.plugin_id.strip():
            raise ValueError("plugin_id is required")
        if manifest.plugin_id in self._plugins:
            raise ValueError(f"Plugin already registered: {manifest.plugin_id}")
        self._plugins[manifest.plugin_id] = _Runtime(manifest=manifest)

    def state(self, plugin_id: str) -> str:
        runtime = self._plugins.get(plugin_id)
        return runtime.state if runtime else "missing"

    def validate(self, plugin_id: str, config: Mapping[str, Any]) -> None:
        runtime = self._require(plugin_id)
        deps = runtime.manifest.dependencies
        errors: list[str] = []
        for module in deps.python_modules:
            if importlib.util.find_spec(module) is None:
                errors.append(f"missing Python module {module}")
        for variable in deps.environment:
            if not os.environ.get(variable, "").strip():
                errors.append(f"missing environment variable {variable}")
        for key in deps.config_keys:
            if config.get(key) in (None, ""):
                errors.append(f"missing configuration key {key}")
        for dependency in deps.plugins:
            if self.state(dependency) != "active":
                errors.append(f"plugin dependency {dependency} is not active")
        if errors:
            raise PluginValidationError(f"Cannot activate {plugin_id}: {'; '.join(errors)}")

    async def activate(self, plugin_id: str, config: Mapping[str, Any] | None = None) -> None:
        runtime = self._require(plugin_id)
        if runtime.state == "active":
            return
        resolved_config = config or {}
        self.validate(plugin_id, resolved_config)
        handles: list[DisposableRegistration] = []
        resources: list[Any] = []
        try:
            for binding in runtime.manifest.registrations:
                binding.registry.activate_owner(plugin_id)
                handles.append(
                    binding.registry.register_owned(
                        binding.key,
                        binding.value,
                        owner_id=plugin_id,
                        plugin_kind=binding.kind,
                        version=runtime.manifest.version,
                        cleanup=binding.cleanup,
                    )
                )
            if runtime.manifest.activate is not None:
                activated = runtime.manifest.activate(resolved_config)
                if inspect.isawaitable(activated):
                    activated = await activated
                if activated is not None:
                    if isinstance(activated, (list, tuple, set)):
                        resources.extend(activated)
                    else:
                        resources.append(activated)
            runtime.registrations = handles
            runtime.resources = resources
            runtime.state = "active"
        except BaseException:
            for handle in reversed(handles):
                handle.dispose()
            for resource in reversed(resources):
                await self._close_resource(resource)
            runtime.state = "failed"
            raise

    @asynccontextmanager
    async def lease(self, plugin_id: str) -> AsyncIterator[None]:
        runtime = self._require(plugin_id)
        async with runtime.condition:
            if runtime.state != "active":
                raise PluginUnavailableError(
                    f"Plugin {plugin_id} is not accepting new work ({runtime.state})"
                )
            runtime.active_leases += 1
        try:
            yield
        finally:
            async with runtime.condition:
                runtime.active_leases = max(0, runtime.active_leases - 1)
                if runtime.active_leases == 0:
                    runtime.condition.notify_all()

    async def deactivate(self, plugin_id: str, *, timeout: float = 30.0) -> None:
        runtime = self._require(plugin_id)
        if runtime.state in {"inactive", "registered"}:
            runtime.state = "inactive"
            return
        async with runtime.condition:
            runtime.state = "draining"
            if runtime.active_leases:
                await asyncio.wait_for(
                    runtime.condition.wait_for(lambda: runtime.active_leases == 0),
                    timeout=max(0.01, timeout),
                )
        registries = {binding.registry for binding in runtime.manifest.registrations}
        for registry in registries:
            await asyncio.to_thread(
                registry.deactivate_owner,
                plugin_id,
                timeout=timeout,
                remove=True,
            )
        for resource in reversed(runtime.resources):
            await self._close_resource(resource)
        runtime.resources.clear()
        runtime.registrations.clear()
        runtime.state = "inactive"

    async def dispose(self, plugin_id: str, *, timeout: float = 30.0) -> None:
        runtime = self._require(plugin_id)
        await self.deactivate(plugin_id, timeout=timeout)
        self._plugins.pop(plugin_id, None)
        runtime.state = "inactive"

    def _require(self, plugin_id: str) -> _Runtime:
        try:
            return self._plugins[plugin_id]
        except KeyError as exc:
            raise PluginUnavailableError(f"Plugin is not registered: {plugin_id}") from exc

    @staticmethod
    async def _close_resource(resource: Any) -> None:
        for method_name in ("aclose", "close", "shutdown", "dispose"):
            method = getattr(resource, method_name, None)
            if not callable(method):
                continue
            result = method()
            if inspect.isawaitable(result):
                await result
            return


__all__ = [
    "LunaPluginManager",
    "LunaPluginManifest",
    "PluginDependencies",
    "PluginUnavailableError",
    "PluginValidationError",
    "RegistryBinding",
]
