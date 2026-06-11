"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import {
  deleteAgentMcpBinding,
  listAgentMcpBindings,
  listMcpServers,
  setAgentMcpBinding,
  type AgentMcpBindingDTO,
  type McpServerDTO,
} from "@/lib/mcp-api";

interface AgentMcpBindingsProps {
  readonly agentId: string;
  readonly canManage: boolean;
}

/** Per-agent MCP tool access: bind a registered server and pick which tools the agent may call. */
export function AgentMcpBindings({ agentId, canManage }: AgentMcpBindingsProps) {
  const [servers, setServers] = useState<McpServerDTO[]>([]);
  const [bindings, setBindings] = useState<AgentMcpBindingDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b] = await Promise.all([listMcpServers(), listAgentMcpBindings(agentId)]);
      setServers(s);
      setBindings(b);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCP bindings");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const bindingFor = (serverId: string) => bindings.find((b) => b.mcpServerId === serverId);

  async function toggleTool(server: McpServerDTO, toolName: string) {
    if (!canManage) return;
    const current = bindingFor(server.id);
    const allowAll = current?.allowedTools.includes("*");
    let next: string[];
    if (allowAll) {
      // Expand "*" to the explicit catalog minus the toggled tool.
      next = (server.tools ?? []).map((t) => t.name).filter((n) => n !== toolName);
    } else {
      const set = new Set(current?.allowedTools ?? []);
      if (set.has(toolName)) set.delete(toolName);
      else set.add(toolName);
      next = Array.from(set);
    }
    setBusy(true);
    try {
      if (next.length === 0) await deleteAgentMcpBinding(agentId, server.id);
      else await setAgentMcpBinding(agentId, server.id, next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update binding");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAll(server: McpServerDTO) {
    if (!canManage) return;
    const current = bindingFor(server.id);
    setBusy(true);
    try {
      if (current) await deleteAgentMcpBinding(agentId, server.id);
      else await setAgentMcpBinding(agentId, server.id, ["*"]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update binding");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReflectiveCard className="rounded-xl" contentClassName="p-5">
      <h2 className="text-[12px] font-medium text-[--text-secondary]">MCP tools</h2>
      <p className="mt-1 text-[11px] text-[--text-tertiary]">
        Grant this agent tools from registered MCP servers. Destructive tools require JIT approval; every
        call is signed to the audit ledger.
      </p>

      {error ? <p className="mt-3 text-[12px] text-[--danger]">{error}</p> : null}

      {loading ? (
        <p className="mt-3 flex items-center gap-1 text-[12px] text-[--text-tertiary]">
          <Loader2 className="size-3 animate-spin" /> Loading…
        </p>
      ) : servers.length === 0 ? (
        <p className="mt-3 text-[12px] text-[--text-tertiary]">
          No MCP servers registered. Add one under Connectors.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {servers.map((server) => {
            const binding = bindingFor(server.id);
            const allowAll = binding?.allowedTools.includes("*") ?? false;
            const bound = Boolean(binding);
            return (
              <div key={server.id} className="rounded-md border border-[--border-subtle] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[--text-primary]">
                    {server.name}{" "}
                    <span className="font-mono text-[11px] text-[--text-tertiary]">mcp.{server.slug}</span>
                  </span>
                  <button
                    type="button"
                    disabled={!canManage || busy}
                    onClick={() => void toggleAll(server)}
                    className="rounded border border-[--border-subtle] px-2 py-1 text-[11px] text-[--text-secondary] hover:bg-white/5 disabled:opacity-40"
                  >
                    {bound ? "Unbind" : "Bind all tools"}
                  </button>
                </div>

                {(server.tools ?? []).length > 0 && bound && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {(server.tools ?? []).map((tool) => {
                      const on = allowAll || (binding?.allowedTools.includes(tool.name) ?? false);
                      return (
                        <li key={tool.id}>
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => void toggleTool(server, tool.name)}
                            title={tool.description}
                            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] disabled:opacity-40 ${
                              on
                                ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-200"
                                : "border-[--border-subtle] text-[--text-tertiary]"
                            }`}
                          >
                            {tool.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {server.tools && server.tools.length === 0 && bound && (
                  <p className="mt-2 text-[11px] text-[--text-tertiary]">
                    Tools discovered at runtime by the agent runner.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ReflectiveCard>
  );
}
