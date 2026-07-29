"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { SketchBox, sketchButton, sketchLabel } from "@/components/qlix/sketch";
import {
  deleteAgentMcpBinding,
  listAgentMcpBindings,
  listMcpServers,
  setAgentMcpBinding,
  type AgentMcpBindingDTO,
  type McpServerDTO,
} from "@/lib/mcp-api";
import { cn } from "@/lib/utils/cn";

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
    <SketchBox className="p-5">
      <h2 className={sketchLabel}>MCP tools</h2>
      <p className="mt-1 text-[11px] text-black/50">
        Grant this agent tools from registered MCP servers. Destructive tools require JIT approval; every
        call is signed to the audit ledger.
      </p>

      {error ? <p className="mt-3 text-[12px] text-black">{error}</p> : null}

      {loading ? (
        <p className="mt-3 flex items-center gap-1 text-[12px] text-black/50">
          <Loader2 className="size-3 animate-spin" /> Loading…
        </p>
      ) : servers.length === 0 ? (
        <p className="mt-3 text-[12px] text-black/50">
          No MCP servers registered. Add one under Connectors.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {servers.map((server) => {
            const binding = bindingFor(server.id);
            const allowAll = binding?.allowedTools.includes("*") ?? false;
            const bound = Boolean(binding);
            return (
              <div key={server.id} className="border border-black p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-black">
                    {server.name}{" "}
                    <span className="font-mono text-[11px] text-black/50">mcp.{server.slug}</span>
                  </span>
                  <button
                    type="button"
                    disabled={!canManage || busy}
                    onClick={() => void toggleAll(server)}
                    className={`${sketchButton} disabled:opacity-40`}
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
                            className={cn(
                              "border border-black px-2 py-0.5 font-mono text-[11px] disabled:opacity-40",
                              on ? "bg-black text-white" : "bg-white text-black hover:bg-black/5",
                            )}
                          >
                            {tool.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {server.tools && server.tools.length === 0 && bound && (
                  <p className="mt-2 text-[11px] text-black/50">
                    Tools discovered at runtime by the agent runner.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SketchBox>
  );
}
