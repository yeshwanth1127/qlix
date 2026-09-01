from __future__ import annotations

import unittest

from qlix.cloud_mcp_runtime import mcp_capability_descriptors
from qlix.identity import AgentIdentity


def _identity(scopes, jit=()):
    return AgentIdentity(
        did="did:qlix:test",
        agent_id="agent_test",
        private_key_hex="00" * 32,
        public_key_hex="11" * 32,
        permission_scopes=tuple(scopes),
        jit_scopes=tuple(jit),
        always_scopes=(),
        backend_url="http://localhost:8080",
        llm_mode="proxy",
        raw={},
    )


SERVERS = [
    {
        "slug": "docs-server",
        "transport": "http",
        "tools": [
            {
                "name": "read.page",
                "description": "Read a page",
                "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}},
                "annotations": {"readOnlyHint": True},
            }
        ],
    },
    {
        "slug": "local-dev",
        "transport": "stdio",
        "tools": [
            {
                "name": "delete_build",
                "inputSchema": {"type": "object", "properties": {}},
                "annotations": {"destructiveHint": True},
            }
        ],
    },
]


class McpCapabilityAdapterTests(unittest.TestCase):
    def test_http_mcp_descriptor_preserves_name_schema_scope_and_provider(self) -> None:
        identity = _identity(["mcp.docs-server.*"], jit=["mcp.docs-server.*"])
        descriptors = mcp_capability_descriptors(identity, SERVERS, runner_runtime="cloud")
        self.assertEqual(len(descriptors), 1)
        descriptor = descriptors[0]
        self.assertTrue(descriptor.name.startswith("mcp__docs-server__read_page_"))
        self.assertEqual(descriptor.input_schema, SERVERS[0]["tools"][0]["inputSchema"])
        self.assertEqual(descriptor.scope_mode, "any")
        self.assertEqual(descriptor.provider.kind, "mcp")
        self.assertEqual(descriptor.provider.id, "docs-server")
        self.assertTrue(descriptor.jit.required)
        self.assertEqual(descriptor.risk.effects, ("read",))

    def test_stdio_mcp_descriptor_is_hybrid_only_and_conservatively_risky(self) -> None:
        identity = _identity(["mcp.local-dev.delete_build"])
        self.assertEqual(mcp_capability_descriptors(identity, SERVERS, runner_runtime="cloud"), [])
        descriptors = mcp_capability_descriptors(identity, SERVERS, runner_runtime="hybrid")
        self.assertEqual(len(descriptors), 1)
        self.assertEqual(descriptors[0].runtimes, ("hybrid",))
        self.assertEqual(descriptors[0].risk.level, "high")
        self.assertIn("write", descriptors[0].risk.effects)


if __name__ == "__main__":
    unittest.main()
