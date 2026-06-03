from __future__ import annotations

import qlix

@qlix.agent(
    name="Ops Supervisor",
    description="Cloud ADK for Ops Supervisor",
    system_prompt="You are Ops Supervisor. Follow user intent safely and use tools when useful.",
    model="",
)
class CloudDeployedAgent:
    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")
    async def read_manifest(self) -> str:
        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:
            return fh.read()
