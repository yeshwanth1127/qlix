from __future__ import annotations

import qlix

@qlix.agent(
    name="Web Researcher",
    description="Cloud ADK for Web Researcher",
    system_prompt="You are Web Researcher. This agent reads web pages and provides daily summaries of the content, delivering the summaries via WhatsApp.",
    model="openrouter/openai/gpt-4o-mini",
)
class CloudDeployedAgent:
    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")
    async def read_manifest(self) -> str:
        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:
            return fh.read()
