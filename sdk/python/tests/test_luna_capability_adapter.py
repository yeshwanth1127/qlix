from __future__ import annotations

import unittest

from qlix.luna.tools._stubs import BaseTool, ToolSpec
from qlix.luna.core.types import ToolResult


class _ExistingTool(BaseTool):
    tool_id = "existing_tool"
    is_local = True

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="existing_tool",
            description="An unchanged existing Luna tool.",
            parameters={"type": "object", "properties": {"value": {"type": "string"}}},
            required_capabilities=["system.file_read"],
        )

    def execute(self, **params):
        return ToolResult(tool_name=self.spec.name, content=str(params), success=True)


class _OverriddenTool(_ExistingTool):
    is_local = False

    @property
    def spec(self) -> ToolSpec:
        spec = super().spec
        spec.metadata["capability"] = {
            "runtimes": ["cloud", "hybrid"],
            "provider": {"kind": "connector", "id": "example"},
            "risk": {"level": "high", "effects": ["external_communication"]},
            "aliases": ["old_existing_tool"],
        }
        return spec


class LunaCapabilityAdapterTests(unittest.TestCase):
    def test_existing_base_tool_gets_descriptor_without_name_or_schema_changes(self) -> None:
        tool = _ExistingTool()
        descriptor = tool.to_capability_descriptor()
        self.assertEqual(descriptor.name, tool.spec.name)
        self.assertEqual(descriptor.input_schema, tool.spec.parameters)
        self.assertEqual(descriptor.required_scopes, ("system.file_read",))
        self.assertEqual(descriptor.runtimes, ("local",))
        self.assertEqual(descriptor.provider.kind, "local")

    def test_product_specific_metadata_can_override_adapter_defaults(self) -> None:
        descriptor = _OverriddenTool().to_capability_descriptor()
        self.assertEqual(descriptor.runtimes, ("cloud", "hybrid"))
        self.assertEqual(descriptor.provider.id, "example")
        self.assertEqual(descriptor.aliases, ("old_existing_tool",))
        self.assertEqual(descriptor.risk.effects, ("external_communication",))


if __name__ == "__main__":
    unittest.main()
