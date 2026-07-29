"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Unplug,
  Users,
  type LucideIcon,
} from "lucide-react";
import { McpAddServer } from "@/components/qlix/mcp/McpAddServer";
import { McpEditServer } from "@/components/qlix/mcp/McpEditServer";
import {
  approveMcpTool,
  deleteMcpServer,
  disconnectMcpOAuth,
  discoverMcpServer,
  listMcpServerAgents,
  listMcpServers,
  setMcpToolGovernance,
  startMcpOAuth,
  type McpGovernance,
  type McpServerAgentDTO,
  type McpServerDTO,
  type McpServerToolDTO,
} from "@/lib/mcp-api";
import { SketchBox, SketchPageHeader, SketchRow, sketchButton, sketchLabel } from "@/components/qlix/sketch";

function toolStatus(tool: McpServerToolDTO): { label: string; Icon: LucideIcon } {
  if (tool.defaultGovernance === "blocked") {
    return { label: "Blocked", Icon: ShieldOff };
  }
  if (tool.needsReapproval) {
    return { label: "Withheld", Icon: ShieldAlert };
  }
  return { label: "Approved", Icon: ShieldCheck };
}

function pretty(value: Record<string, unknown> | null): string | null {
  return value ? JSON.stringify(value, null, 2) : null;
}

export function McpServersView() {
  const [servers, setServers] = useState<McpServerDTO[]>([]);
  const [agentsByServer, setAgentsByServer] = useState<Record<string, McpServerAgentDTO[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openDiff, setOpenDiff] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMcpServers();
      setServers(list);
      const entries = await Promise.all(
        list.map(async (s) => [s.id, await listMcpServerAgents(s.id).catch(() => [])] as const),
      );
      setAgentsByServer(Object.fromEntries(entries));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCP servers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data && typeof e.data === "object" && e.data.type === "qlix-mcp-oauth") {
        if (!e.data.ok && typeof e.data.message === "string") setError(`OAuth failed: ${e.data.message}`);
        void refresh();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh]);

  async function handleReconnect(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const url = await startMcpOAuth(id);
      window.open(url, "qlix-mcp-oauth", "width=620,height=760");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start OAuth");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect(id: string) {
    if (!window.confirm("Disconnect this OAuth account? Agents will lose access until reconnected.")) return;
    setBusyId(id);
    try {
      await disconnectMcpOAuth(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDiscover(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await discoverMcpServer(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this MCP server? Agents bound to it will lose its tools.")) return;
    setBusyId(id);
    try {
      await deleteMcpServer(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete server");
    } finally {
      setBusyId(null);
    }
  }

  async function handleGovernance(serverId: string, tool: string, governance: McpGovernance) {
    try {
      await setMcpToolGovernance(serverId, tool, governance);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set governance");
    }
  }

  async function handleApprove(serverId: string, tool: string) {
    try {
      await approveMcpTool(serverId, tool);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve tool");
    }
  }

  return (
    <div className="mt-10 max-w-2xl bg-white">
      <SketchPageHeader
        title="MCP Servers"
        actions={
          <button type="button" onClick={() => setShowForm((v) => !v)} className={sketchButton}>
            {showForm ? "Cancel" : "Add MCP server"}
          </button>
        }
      />
      <p className="mt-2 text-[13px] leading-relaxed text-black/70">
        Connect any Model Context Protocol server to give agents its tools. Every call is scoped,
        audited on the signed ledger, and gated by JIT approval — bind tools to an agent on its detail page.
      </p>

      {error && (
        <SketchBox className="mt-4 px-3 py-2 text-[13px] text-black">{error}</SketchBox>
      )}

      {showForm && (
        <McpAddServer
          onDone={() => {
            setShowForm(false);
            void refresh();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <p className="mt-6 flex items-center gap-1 text-[12px] text-black/50">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </p>
      ) : servers.length === 0 ? (
        <p className="mt-6 text-[12px] text-black/50">No MCP servers yet.</p>
      ) : (
        servers.map((server) => {
          const boundAgents = agentsByServer[server.id] ?? [];
          return (
            <SketchBox key={server.id} className="mt-4 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="border border-black p-2">
                    <Plug size={20} className="text-black" />
                  </div>
                  <div>
                    <h3 className="text-[13px] font-medium text-black">
                      {server.name}{" "}
                      <span className="text-[11px] text-black/50">
                        ({server.transport} · mcp.{server.slug})
                      </span>
                    </h3>
                    <p className="mt-1 text-[12px] text-black/60">
                      {server.transport === "http" ? server.endpointUrl : server.command}
                    </p>
                    <p className="mt-1 font-serif text-[10px] uppercase tracking-widest text-black/50">
                      {server.status}
                      {server.lastError ? ` — ${server.lastError}` : ""}
                    </p>
                    {boundAgents.length > 0 && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-black/50">
                        <Users size={11} /> Used by {boundAgents.map((a) => a.agentName).join(", ")}
                      </p>
                    )}
                    {server.authType === "oauth" && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-black/60">
                        <KeyRound size={11} />
                        {server.oauthConnected ? "OAuth connected" : "OAuth not connected"}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {server.authType === "oauth" && (
                    <button
                      type="button"
                      onClick={() => void handleReconnect(server.id)}
                      disabled={busyId === server.id}
                      title={server.oauthConnected ? "Reconnect account" : "Connect account"}
                      className={`${sketchButton} p-1.5 disabled:opacity-40`}
                    >
                      <KeyRound size={14} />
                    </button>
                  )}
                  {server.authType === "oauth" && server.oauthConnected && (
                    <button
                      type="button"
                      onClick={() => void handleDisconnect(server.id)}
                      disabled={busyId === server.id}
                      title="Disconnect account"
                      className={`${sketchButton} p-1.5 disabled:opacity-40`}
                    >
                      <Unplug size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingId((id) => (id === server.id ? null : server.id))}
                    title="Edit server"
                    className={`${sketchButton} p-1.5`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDiscover(server.id)}
                    disabled={busyId === server.id}
                    title="Re-discover tools"
                    className={`${sketchButton} p-1.5 disabled:opacity-40`}
                  >
                    {busyId === server.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(server.id)}
                    disabled={busyId === server.id}
                    title="Delete server"
                    className={`${sketchButton} p-1.5 disabled:opacity-40`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {editingId === server.id && (
                <McpEditServer
                  server={server}
                  onSaved={() => {
                    setEditingId(null);
                    void refresh();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              )}

              {server.tools && server.tools.length > 0 && (
                <div className="mt-4 border-t border-black pt-3">
                  <p className={sketchLabel}>Tools ({server.tools.length})</p>
                  <div className="mt-2 space-y-1.5">
                    {server.tools.map((tool) => {
                      const status = toolStatus(tool);
                      const key = `${server.id}:${tool.name}`;
                      const open = openDiff === key;
                      const affected = boundAgents.filter(
                        (a) => a.allowedTools.includes("*") || a.allowedTools.includes(tool.name),
                      );
                      return (
                        <SketchBox key={tool.id} className="overflow-hidden">
                          <div className="flex items-center justify-between gap-3 p-2">
                            <div className="min-w-0">
                              <p className="truncate text-[12px] text-black">
                                {tool.name}{" "}
                                <span className="text-[11px] text-black/50">· {tool.riskLevel}</span>
                              </p>
                              {tool.description && (
                                <p className="truncate text-[11px] text-black/50">{tool.description}</p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="inline-flex items-center gap-1 border border-black px-1.5 py-0.5 text-[10px] text-black">
                                <status.Icon size={11} /> {status.label}
                              </span>
                              {tool.needsReapproval && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setOpenDiff(open ? null : key)}
                                    className={`${sketchButton} gap-0.5 py-1 text-[11px]`}
                                  >
                                    <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                                    diff
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleApprove(server.id, tool.name)}
                                    className={`${sketchButton} py-1 text-[11px]`}
                                  >
                                    Re-approve
                                  </button>
                                </>
                              )}
                              <select
                                value={tool.defaultGovernance}
                                onChange={(e) =>
                                  void handleGovernance(server.id, tool.name, e.target.value as McpGovernance)
                                }
                                className="border border-black bg-white px-2 py-1 text-[11px] text-black"
                              >
                                <option value="auto">auto</option>
                                <option value="jit">jit</option>
                                <option value="blocked">blocked</option>
                              </select>
                            </div>
                          </div>

                          {open && tool.needsReapproval && (
                            <div className="border-t border-black p-2">
                              <p className="text-[11px] text-black/70">
                                Withheld from agents: this tool&apos;s definition changed after it was approved.
                              </p>
                              <DiffRow label="Description" before={tool.approvedDescription} after={tool.description} />
                              <DiffRow
                                label="Input schema"
                                before={pretty(tool.approvedInputSchema)}
                                after={pretty(tool.inputSchema)}
                              />
                              {affected.length > 0 && (
                                <p className="mt-2 text-[11px] text-black/50">
                                  Affects: {affected.map((a) => a.agentName).join(", ")}
                                </p>
                              )}
                            </div>
                          )}
                        </SketchBox>
                      );
                    })}
                  </div>
                </div>
              )}
            </SketchBox>
          );
        })
      )}
    </div>
  );
}

function DiffRow({
  label,
  before,
  after,
}: {
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
}) {
  if ((before ?? "") === (after ?? "")) return null;
  return (
    <div className="mt-2">
      <p className={`${sketchLabel} text-[10px]`}>{label}</p>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap border border-black bg-white px-2 py-1 text-[10px] text-black/70">
        − {before ?? "(none)"}
      </pre>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap border border-black bg-white px-2 py-1 text-[10px] text-black">
        + {after ?? "(none)"}
      </pre>
    </div>
  );
}
