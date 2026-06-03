from __future__ import annotations

import qlix

@qlix.agent(
    name="TL-test",
    description="Cloud ADK for TL-test",
    system_prompt="You are TL-test. Follow user intent safely and use tools when useful.",
    model="openrouter/anthropic/claude-3.5-sonnet",
)
class CloudDeployedAgent:
    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")
    async def read_manifest(self) -> str:
        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:
            return fh.read()
