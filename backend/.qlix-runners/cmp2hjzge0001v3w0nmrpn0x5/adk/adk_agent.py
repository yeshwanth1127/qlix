from __future__ import annotations

import qlix

@qlix.agent(
    name="cloud-cmp2hjzge0001v3w0nmrpn0x5",
    description="Cloud ADK for test",
    system_prompt="You are test. Follow user intent safely and use tools when useful.",
    model="openrouter/anthropic/claude-3.5-sonnet",
)
class CloudDeployedAgent:
    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")
    async def read_manifest(self) -> str:
        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:
            return fh.read()
