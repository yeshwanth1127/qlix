from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


SDK_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SDK_ROOT / "scripts/generate_capability_inventory.py"
SNAPSHOT = SDK_ROOT / "capability_inventory.json"
REGRESSION_FIXTURES = SDK_ROOT / "capability_regression_fixtures.json"


def _load_generator():
    spec = importlib.util.spec_from_file_location("qlix_capability_inventory", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CapabilityInventoryTests(unittest.TestCase):
    def test_capability_inventory_is_current(self) -> None:
        generator = _load_generator()
        self.assertEqual(
            SNAPSHOT.read_text(encoding="utf-8"),
            generator.render_inventory(),
        )

    def test_inventory_protects_critical_existing_surfaces(self) -> None:
        inventory = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        scopes = set(inventory["backend"]["permissionScopes"])
        for scope in {
            "assessment.evidence.search",
            "brain.query",
            "email.send",
            "system.file_write",
            "web.research",
            "whatsapp.contact_send",
        }:
            self.assertIn(scope, scopes)

        agents = set(inventory["luna"]["registries"]["AgentRegistry"])
        for agent in {"deep_research", "native_openhands", "native_react", "rlm"}:
            self.assertIn(agent, agents)

        self.assertEqual(
            inventory["lunaTeams"]["commanderTools"],
            ["dispatch_to", "interrupt_member", "request_wait", "wait_result"],
        )

        self.assertEqual(
            set(inventory["backend"]["gatewayChannels"]),
            {"local", "slack", "telegram", "web", "whatsapp"},
        )

    def test_runtime_inventory_preserves_cloud_hybrid_boundaries(self) -> None:
        inventory = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        runtime = inventory["managedRuntime"]
        cloud = set(runtime["runtimeTools"]["cloud"])
        hybrid = set(runtime["runtimeTools"]["hybrid"])

        for tool in {"research_web_search", "assessment_evidence_search", "email_read"}:
            self.assertIn(tool, cloud)
            self.assertIn(tool, hybrid)
        for tool in {"luna_local_read_file", "luna_local_bash", "gui_control"}:
            self.assertIn(tool, hybrid)
            self.assertNotIn(tool, cloud)
        self.assertIn("browser", cloud)
        self.assertNotIn("browser", hybrid)
        self.assertIn("web", runtime["groupRuntimes"])

        self.assertEqual(
            set(inventory["lunaTeams"]["provenanceFields"]),
            {"inputRefs", "recordRefs", "knowledgeRefs", "toolRefs", "evidenceRefs", "artifactRefs"},
        )

    def test_skills_mcp_and_aliases_remain_discoverable(self) -> None:
        inventory = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        skills = set(inventory["luna"]["skills"]["builtIn"])
        for skill in {"topic-research", "web-summarize", "code-lint", "pdf-summarize"}:
            self.assertIn(skill, skills)
        self.assertEqual(inventory["luna"]["compatibilityAliases"]["agents"]["react"], "native_react")
        self.assertEqual(
            inventory["luna"]["compatibilityAliases"]["discoveredToolPrefixes"],
            {"functions.": "", "tools.": ""},
        )
        self.assertEqual(inventory["mcp"]["transports"]["stdio"], ["hybrid"])
        self.assertEqual(set(inventory["mcp"]["transports"]["http"]), {"cloud", "hybrid"})

    def test_every_advertised_scope_has_an_implementation_reference(self) -> None:
        inventory = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        self.assertEqual(inventory["consistency"]["unmappedPermissionScopes"], [])

    def test_every_runner_tool_has_capability_metadata(self) -> None:
        inventory = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        runtime = inventory["managedRuntime"]
        descriptors = runtime["toolCapabilities"]
        self.assertEqual(inventory["consistency"]["runnerToolsMissingCapabilityMetadata"], [])
        for runtime_name, tools in runtime["runtimeTools"].items():
            for tool in tools:
                descriptor = descriptors[tool]
                self.assertIn(runtime_name, descriptor["runtimes"], tool)
                self.assertTrue(descriptor["groups"], tool)
                self.assertIs(descriptor["scopeGated"], True, tool)

    def test_compatibility_aliases_resolve_to_existing_capabilities(self) -> None:
        inventory = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        self.assertEqual(inventory["consistency"]["brokenAgentCompatibilityAliases"], [])
        agents = set(inventory["luna"]["registries"]["AgentRegistry"])
        for alias, target in inventory["luna"]["compatibilityAliases"]["agents"].items():
            self.assertIn(target, agents, alias)
        self.assertEqual(
            set(inventory["luna"]["compatibilityAliases"]["discoveredToolPrefixes"]),
            {"functions.", "tools."},
        )

    def test_critical_configuration_defaults_are_snapshotted(self) -> None:
        inventory = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        defaults = inventory["luna"]["configDefaults"]["classes"]
        self.assertEqual(defaults["AgentConfig"]["default_agent"], "simple")
        self.assertEqual(defaults["AgentConfig"]["max_turns"], 10)
        self.assertEqual(defaults["BrowserConfig"]["timeout_ms"], 30_000)
        self.assertEqual(defaults["MCPConfig"]["enabled"], True)
        self.assertEqual(defaults["SkillsConfig"]["active"], "*")
        self.assertEqual(defaults["IntelligenceConfig"]["temperature"], 0.7)

    def test_representative_capability_fixtures_remain_satisfied(self) -> None:
        inventory = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        fixture_file = json.loads(REGRESSION_FIXTURES.read_text(encoding="utf-8"))
        fixtures = fixture_file["fixtures"]
        self.assertEqual(fixture_file["formatVersion"], 1)
        self.assertEqual(
            {fixture["area"] for fixture in fixtures},
            {
                "research", "browser", "coding", "files", "documents", "email",
                "whatsapp", "scheduling", "brain", "mcp", "teams", "waits",
                "assessment",
            },
        )
        self.assertEqual(len({fixture["id"] for fixture in fixtures}), len(fixtures))

        scopes = set(inventory["backend"]["permissionScopes"])
        runtime_tools = {
            runtime: set(tools)
            for runtime, tools in inventory["managedRuntime"]["runtimeTools"].items()
        }
        team_tools = set(inventory["lunaTeams"]["commanderTools"])
        provenance_fields = set(inventory["lunaTeams"]["provenanceFields"])
        mcp = inventory["mcp"]

        for fixture in fixtures:
            label = fixture["id"]
            self.assertTrue(fixture["example"].strip(), label)
            for scope in fixture.get("requiredScopes", []):
                self.assertIn(scope, scopes, label)
            for runtime in fixture.get("runtimes", []):
                self.assertIn(runtime, runtime_tools, label)
                for tool in fixture.get("requiredTools", []):
                    self.assertIn(tool, runtime_tools[runtime], f"{label}: {runtime}")
            for tool in fixture.get("requiredTeamTools", []):
                self.assertIn(tool, team_tools, label)
            for field in fixture.get("requiredProvenanceFields", []):
                self.assertIn(field, provenance_fields, label)
            for transport in fixture.get("requiredMcpTransports", []):
                self.assertIn(transport, mcp["transports"], label)
                for runtime in fixture.get("runtimes", []):
                    self.assertIn(runtime, mcp["transports"][transport], label)
            if "requiredMcpToolPattern" in fixture:
                self.assertEqual(fixture["requiredMcpToolPattern"], mcp["toolNamePattern"], label)


if __name__ == "__main__":
    unittest.main()
