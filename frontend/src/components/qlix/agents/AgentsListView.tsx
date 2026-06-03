"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  type AgentDTO,
  listAgents,
} from "@/lib/agents-api";
import { useSession } from "@/components/qlix/session-context";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import { CreateAgentModal } from "./CreateAgentModal";
import { deriveAgentDisplayStatus } from "./agentStatus";

interface AgentsListViewProps {
  readonly routePrefix: "/individual" | "/organization";
}

export function AgentsListView({ routePrefix }: AgentsListViewProps) {
  const { session } = useSession();
  const [agents, setAgents] = useState<AgentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const isOrg = routePrefix === "/organization";
  const orgId = isOrg ? session?.organization.id ?? null : null;
  const deviceVerified = session?.user.deviceVerified === true;

  const derivedStatus = (agent: AgentDTO): string => deriveAgentDisplayStatus(agent);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAgents(orgId);
      if (!data) {
        setError("Could not load agents (try signing in again).");
        setAgents(null);
        return;
      }
      setAgents(data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreated = (agent: AgentDTO) => {
    setAgents((prev) => [
      {
        id: agent.id,
        userId: agent.userId,
        orgId: agent.orgId,
        did: agent.did,
        publicKey: agent.publicKey,
        name: agent.name,
        status: agent.status,
        runtime: agent.runtime,
        model: agent.model,
        localInferenceMode: agent.localInferenceMode,
        llmMode: agent.llmMode,
        permissionScopes: agent.permissionScopes,
        jitScopes: agent.jitScopes,
        alwaysScopes: agent.alwaysScopes,
        webauthnCredentialId: agent.webauthnCredentialId,
        keypairDeliveredAt: agent.keypairDeliveredAt,
        lastConnectedAt: agent.lastConnectedAt,
        lastActive: agent.lastActive,
        createdAt: agent.createdAt,
        cloudProvisioningStatus: agent.cloudProvisioningStatus,
        cloudRunnerId: agent.cloudRunnerId,
        cloudLastHeartbeatAt: agent.cloudLastHeartbeatAt,
      },
      ...(prev ?? []),
    ]);
  };

  return (
    <div className="animate-qlix-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">Agents</h1>
          <p className="mt-1 text-[13px] text-[--text-secondary]">
            Register and manage AI agents with DIDs and verifiable credentials.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[--accent] px-3 py-1.5 text-[12px] font-medium text-[--accent-contrast] transition-colors hover:bg-[--accent-hover]"
        >
          <Plus className="size-3.5" aria-hidden />
          Create agent
        </button>
      </div>

      <ReflectiveCard className="overflow-hidden rounded-xl">
        {loading ? (
          <p className="px-4 py-8 text-center text-[12px] text-[--text-tertiary]">Loading…</p>
        ) : error ? (
          <p className="px-4 py-8 text-center text-[12px] text-[--danger]">{error}</p>
        ) : !agents || agents.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-[--text-tertiary]">
            No agents yet. Click <span className="font-medium">Create agent</span> to register your first.
          </p>
        ) : (
          <table className="w-full border-collapse text-left">
            {/* Avoid qlix-glass-inset on <tr> — its ::before + position:relative breaks thead/tbody column alignment in Chrome. */}
            <thead className="border-b border-[--border-subtle] bg-[var(--glass-inset-bg)]">
              <tr>
                <Th>Name</Th>
                <Th>DID</Th>
                <Th>Runtime</Th>
                <Th>Model</Th>
                <Th>Scopes</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-[--border-subtle] transition-colors last:border-0 hover:bg-[var(--glass-row-hover)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`${routePrefix}/agents/${a.id}`}
                      className="text-[13px] font-medium text-[--text-primary] hover:text-[--accent]"
                    >
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[--text-secondary]" title={a.did}>
                    {a.did}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[--text-secondary] capitalize">{a.runtime}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[--text-secondary]">{a.model}</td>
                  <td className="px-4 py-3 text-[12px] text-[--text-tertiary]">
                    {a.alwaysScopes.length} always · {a.jitScopes.length} JIT
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[--text-secondary] capitalize">
                    {derivedStatus(a)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReflectiveCard>

      <CreateAgentModal
        open={open}
        onClose={() => {
          setOpen(false);
          void refresh();
        }}
        onCreated={handleCreated}
        orgId={orgId}
        deviceVerified={deviceVerified}
      />
    </div>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
      {children}
    </th>
  );
}
