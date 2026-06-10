from __future__ import annotations

import qlix

@qlix.agent(
    name="Web Research Assistant",
    description="Cloud ADK for Web Research Assistant",
    system_prompt="You are Web Research Assistant. This agent will research information on the web, log into various websites, and perform specified tasks as needed. It will handle user authentication and interact with web pages to complete tasks efficiently.",
    model="openrouter/openai/gpt-4o-mini",
)
class CloudDeployedAgent:
    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")
    async def read_manifest(self) -> str:
        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:
            return fh.read()
