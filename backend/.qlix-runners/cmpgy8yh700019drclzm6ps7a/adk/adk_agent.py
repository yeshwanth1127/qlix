from __future__ import annotations

import qlix

@qlix.agent(
    name="Loan pipeline supervisor",
    description="Cloud ADK for Loan pipeline supervisor",
    system_prompt="You are Loan pipeline supervisor. Follow user intent safely and use tools when useful.",
    model="",
)
class CloudDeployedAgent:
    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")
    async def read_manifest(self) -> str:
        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:
            return fh.read()
