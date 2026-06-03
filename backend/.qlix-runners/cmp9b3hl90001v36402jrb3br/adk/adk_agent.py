from __future__ import annotations

import qlix

@qlix.agent(
    name="cloud-cmp9b3hl90001v36402jrb3br",
    description="Cloud ADK for Company brain · ysw's Organization",
    system_prompt="You are Company brain · ysw's Organization. Follow user intent safely and use tools when useful.",
    model="claude-sonnet-4-6",
)
class CloudDeployedAgent:
    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")
    async def read_manifest(self) -> str:
        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:
            return fh.read()
