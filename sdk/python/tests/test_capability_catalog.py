from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

from qlix.contracts import CapabilityDescriptor
from qlix.capability_catalog import catalog_tool_definitions


SDK_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SDK_ROOT / "scripts/generate_capability_catalog.py"
CATALOG = SDK_ROOT / "qlix/data/capability_catalog.json"
INVENTORY = SDK_ROOT / "capability_inventory.json"


def _load_generator():
    spec = importlib.util.spec_from_file_location("qlix_capability_catalog", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CapabilityCatalogTests(unittest.TestCase):
    def test_catalog_is_current(self) -> None:
        self.assertEqual(CATALOG.read_text(encoding="utf-8"), _load_generator().render_catalog())

    def test_every_inventory_tool_has_one_valid_descriptor(self) -> None:
        inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["capabilities"]
        self.assertEqual(set(catalog), set(inventory["managedRuntime"]["toolCapabilities"]))
        for name, wire in catalog.items():
            descriptor = CapabilityDescriptor.from_wire(wire)
            self.assertEqual(descriptor.name, name)
            self.assertTrue(descriptor.description, name)
            self.assertEqual(descriptor.input_schema.get("type"), "object", name)
            self.assertTrue(descriptor.runtimes, name)

    def test_special_scope_and_provider_semantics_are_preserved(self) -> None:
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["capabilities"]
        self.assertEqual(catalog["luna_local_send_whatsapp_document"]["scopeMode"], "any")
        self.assertEqual(catalog["browser"]["scopeMode"], "any")
        self.assertEqual(catalog["email_send"]["provider"], {"kind": "connector", "id": "email"})
        self.assertIn("external_communication", catalog["whatsapp_send_message"]["risk"]["effects"])
        self.assertEqual(catalog["assessment_evidence_search"]["provider"]["id"], "qlix.assessment")

    def test_catalog_generated_tool_arrays_match_current_runtime_arrays(self) -> None:
        generator = _load_generator()
        inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
        definitions, current_arrays = generator._tool_surfaces(inventory)
        catalog_arrays = json.loads(CATALOG.read_text(encoding="utf-8"))["toolArrays"]
        self.assertEqual(catalog_arrays, current_arrays)
        for array_name, runtime, browser_mode in (
            ("cloudCollapsed", "cloud", "collapsed"),
            ("cloudExpanded", "cloud", "expanded"),
            ("hybrid", "hybrid", "collapsed"),
        ):
            expected = [
                {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": definitions[name]["description"],
                        "parameters": definitions[name]["inputSchema"],
                    },
                }
                for name in current_arrays[array_name]
            ]
            self.assertEqual(
                catalog_tool_definitions(runtime=runtime, browser_mode=browser_mode),
                expected,
                array_name,
            )


if __name__ == "__main__":
    unittest.main()
