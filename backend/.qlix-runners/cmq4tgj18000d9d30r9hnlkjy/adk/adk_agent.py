from __future__ import annotations

import qlix

@qlix.agent(
    name="DTI Calculator",
    description="Cloud ADK for DTI Calculator",
    system_prompt="You are DTI Calculator. Follow user intent safely and use tools when useful.",
    model="",
)
class CloudDeployedAgent:
    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")
    async def read_manifest(self) -> str:
        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:
            return fh.read()
