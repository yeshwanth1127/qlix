from __future__ import annotations

import qlix

@qlix.agent(
    name="Executor Worker",
    description="Cloud ADK for Executor Worker",
    system_prompt="You are Executor Worker. Follow user intent safely and use tools when useful.",
    model="",
)
class CloudDeployedAgent:
    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")
    async def read_manifest(self) -> str:
        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:
            return fh.read()
