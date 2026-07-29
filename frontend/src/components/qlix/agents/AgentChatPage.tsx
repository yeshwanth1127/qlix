"use client";

import { AgentChatPanel } from "./AgentChatPanel";

interface AgentChatPageProps {
  readonly agentId: string;
  readonly routePrefix: "/individual" | "/organization";
}

/**
 * Full-page chat for a single agent. The conversation fills the page; a back
 * link returns to the agent registry. Agent name, status and the Clear action
 * live inside {@link AgentChatPanel}'s own header.
 */
export function AgentChatPage({ agentId, routePrefix }: AgentChatPageProps) {
  const isOrg = routePrefix === "/organization";
  return (
    <div className="animate-qlix-fade-in flex h-full min-h-0 flex-col">
      <div
        className="qlix-section-in min-h-0 flex-1"
        style={{ "--qlix-stagger-i": 0 } as React.CSSProperties}
      >
        <AgentChatPanel
          agentId={agentId}
          backHref={`${routePrefix}/agents`}
          aiBrainHref={isOrg ? `${routePrefix}/ai-brain` : undefined}
        />
      </div>
    </div>
  );
}
