from __future__ import annotations

import asyncio

import pytest

from qlix.identity import AgentIdentity
from qlix.sdk import QlixSDK

from qlix.luna.core.registry import (
    ConnectorRegistry,
    EngineRegistry,
    SkillRegistry,
    ToolRegistry,
)
from qlix.luna.plugins import (
    LunaPluginManager,
    LunaPluginManifest,
    PluginDependencies,
    PluginUnavailableError,
    PluginValidationError,
    RegistryBinding,
)


@pytest.mark.asyncio
async def test_one_plugin_can_own_and_clean_every_luna_capability_type() -> None:
    manager = LunaPluginManager()

    class _Resource:
        closed = False

        async def aclose(self) -> None:
            self.closed = True

    resource = _Resource()
    bindings = (
        RegistryBinding(ToolRegistry, "phase11_tool", object(), "tool"),
        RegistryBinding(EngineRegistry, "phase11_engine", object(), "engine"),
        RegistryBinding(ConnectorRegistry, "phase11_connector", object(), "connector"),
        RegistryBinding(SkillRegistry, "phase11_skill", object(), "skill"),
    )
    manager.register(
        LunaPluginManifest(
            plugin_id="phase11",
            registrations=bindings,
            activate=lambda _config: resource,
        )
    )
    await manager.activate("phase11")

    assert all(binding.registry.contains(binding.key) for binding in bindings)
    assert ToolRegistry.metadata("phase11_tool").owner_id == "phase11"

    entered = asyncio.Event()
    release = asyncio.Event()

    async def active_work() -> None:
        async with manager.lease("phase11"):
            entered.set()
            await release.wait()

    task = asyncio.create_task(active_work())
    await entered.wait()
    stopping = asyncio.create_task(manager.deactivate("phase11"))
    await asyncio.sleep(0)
    with pytest.raises(PluginUnavailableError):
        async with manager.lease("phase11"):
            pass
    release.set()
    await task
    await stopping

    assert resource.closed is True
    assert all(not binding.registry.contains(binding.key) for binding in bindings)


@pytest.mark.asyncio
async def test_plugin_dependencies_and_configuration_are_validated_before_registration() -> None:
    manager = LunaPluginManager()
    manager.register(
        LunaPluginManifest(
            plugin_id="invalid",
            dependencies=PluginDependencies(
                python_modules=("module_that_does_not_exist_qlix",),
                config_keys=("endpoint",),
            ),
            registrations=(
                RegistryBinding(ToolRegistry, "must_not_leak", object(), "tool"),
            ),
        )
    )
    with pytest.raises(PluginValidationError):
        await manager.activate("invalid", {})
    assert ToolRegistry.contains("must_not_leak") is False


@pytest.mark.asyncio
async def test_sdk_owns_and_closes_the_live_luna_system(monkeypatch: pytest.MonkeyPatch) -> None:
    class _System:
        closed = False

        def close(self) -> None:
            self.closed = True

    class _Builder:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            self.system = _System()

        def engine(self, _name: str) -> "_Builder":
            return self

        def build(self) -> _System:
            return self.system

    class _Http:
        closed = False

        async def aclose(self) -> None:
            self.closed = True

    import qlix.luna.system.builder as builder_module
    import qlix.luna_bridge as bridge_module

    monkeypatch.setattr(builder_module, "SystemBuilder", _Builder)
    monkeypatch.setattr(bridge_module, "wrap_tool_executor_with_qlix", lambda *_args: None)
    identity = AgentIdentity(
        did="did:qlix:lifecycle",
        agent_id="lifecycle",
        private_key_hex="11" * 32,
        public_key_hex="22" * 32,
        permission_scopes=("*",),
        jit_scopes=(),
        always_scopes=("*",),
        backend_url="http://test",
        llm_mode="proxy",
        raw={},
    )
    http = _Http()
    sdk = QlixSDK(identity=identity, http=http)  # type: ignore[arg-type]
    system = await sdk.start()
    plugin_id = sdk._runtime_plugin_ids[0]
    assert sdk.plugins.state(plugin_id) == "active"

    await sdk.aclose()

    assert system.closed is True
    assert http.closed is True
    assert sdk.plugins.state(plugin_id) == "missing"
