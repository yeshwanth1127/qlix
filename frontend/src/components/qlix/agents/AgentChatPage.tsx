"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
    <div className="animate-qlix-fade-in space-y-4">
      <Link
        href={`${routePrefix}/agents`}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[--text-secondary] transition-colors hover:text-violet-600 dark:hover:text-violet-300"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to agents
      </Link>

      <AgentChatPanel
        agentId={agentId}
        aiBrainHref={isOrg ? `${routePrefix}/ai-brain` : undefined}
      />
    </div>
  );
}
