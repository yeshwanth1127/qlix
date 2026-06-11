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
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
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

const riskColor: Record<string, string> = {
  low: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-red-400",
};

const statusColor: Record<string, string> = {
  connected: "text-emerald-400",
  pending: "text-amber-400",
  error: "text-red-400",
  revoked: "text-white/40",
};

/** Trust state of a tool: whether its current definition is approved & delivered to agents. */
function toolStatus(tool: McpServerToolDTO): { label: string; cls: string; Icon: LucideIcon } {
  if (tool.defaultGovernance === "blocked") {
    return { label: "Blocked", cls: "border-white/15 text-white/40", Icon: ShieldOff };
  }
  if (tool.needsReapproval) {
    return { label: "Withheld", cls: "border-red-500/40 bg-red-500/10 text-red-300", Icon: ShieldAlert };
  }
  return { label: "Approved", cls: "border-emerald-500/30 text-emerald-300", Icon: ShieldCheck };
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

  // The OAuth popup posts this when the provider redirect completes; refresh to reflect it.
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
    <div className="animate-qlix-fade-in mt-10 max-w-2xl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server size={18} className="text-indigo-400" />
          <h2 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">MCP Servers</h2>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-500"
        >
          {showForm ? "Cancel" : "Add MCP server"}
        </button>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[--text-secondary]">
        Connect any Model Context Protocol server to give agents its tools. Every call is scoped,
        audited on the signed ledger, and gated by JIT approval — bind tools to an agent on its detail page.
      </p>

      {error && (
        <p className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
          {error}
        </p>
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
        <p className="mt-6 flex items-center gap-1 text-[12px] text-white/35">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </p>
      ) : servers.length === 0 ? (
        <p className="mt-6 text-[12px] text-white/40">No MCP servers yet.</p>
      ) : (
        servers.map((server) => {
          const boundAgents = agentsByServer[server.id] ?? [];
          return (
            <ReflectiveCard key={server.id} className="mt-4 rounded" contentClassName="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-white/5 p-2">
                    <Plug size={20} className="text-sky-400" />
                  </div>
                  <div>
                    <h3 className="text-[13px] font-medium text-white/90">
                      {server.name}{" "}
                      <span className="text-[11px] text-white/35">
                        ({server.transport} · mcp.{server.slug})
                      </span>
                    </h3>
                    <p className="mt-1 text-[12px] text-white/45">
                      {server.transport === "http" ? server.endpointUrl : server.command}
                    </p>
                    <p className={`mt-1 text-[12px] ${statusColor[server.status] ?? "text-white/40"}`}>
                      {server.status}
                      {server.lastError ? ` — ${server.lastError}` : ""}
                    </p>
                    {boundAgents.length > 0 && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-white/40">
                        <Users size={11} /> Used by {boundAgents.map((a) => a.agentName).join(", ")}
                      </p>
                    )}
                    {server.authType === "oauth" && (
                      <p
                        className={`mt-1 inline-flex items-center gap-1 text-[11px] ${
                          server.oauthConnected ? "text-emerald-300" : "text-amber-300"
                        }`}
                      >
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
                      className="rounded border border-white/10 p-1.5 text-emerald-300/90 hover:bg-emerald-500/10 disabled:opacity-40"
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
                      className="rounded border border-white/10 p-1.5 text-amber-300/80 hover:bg-amber-500/10 disabled:opacity-40"
                    >
                      <Unplug size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingId((id) => (id === server.id ? null : server.id))}
                    title="Edit server"
                    className={`rounded border border-white/10 p-1.5 hover:bg-white/5 ${
                      editingId === server.id ? "text-indigo-300" : "text-white/70"
                    }`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDiscover(server.id)}
                    disabled={busyId === server.id}
                    title="Re-discover tools"
                    className="rounded border border-white/10 p-1.5 text-white/70 hover:bg-white/5 disabled:opacity-40"
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
                    className="rounded border border-white/10 p-1.5 text-red-300/80 hover:bg-red-500/10 disabled:opacity-40"
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
                <div className="mt-4 border-t border-white/5 pt-3">
                  <p className="text-[11px] uppercase tracking-wide text-white/30">
                    Tools ({server.tools.length})
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {server.tools.map((tool) => {
                      const status = toolStatus(tool);
                      const key = `${server.id}:${tool.name}`;
                      const open = openDiff === key;
                      const affected = boundAgents.filter(
                        (a) => a.allowedTools.includes("*") || a.allowedTools.includes(tool.name),
                      );
                      return (
                        <div key={tool.id} className="rounded-md border border-white/5">
                          <div className="flex items-center justify-between gap-3 p-2">
                            <div className="min-w-0">
                              <p className="truncate text-[12px] text-white/80">
                                {tool.name}{" "}
                                <span className={`text-[11px] ${riskColor[tool.riskLevel] ?? ""}`}>
                                  · {tool.riskLevel}
                                </span>
                              </p>
                              {tool.description && (
                                <p className="truncate text-[11px] text-white/40">{tool.description}</p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${status.cls}`}
                              >
                                <status.Icon size={11} /> {status.label}
                              </span>
                              {tool.needsReapproval && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setOpenDiff(open ? null : key)}
                                    className="flex items-center gap-0.5 rounded border border-white/10 px-1.5 py-1 text-[11px] text-white/60 hover:bg-white/5"
                                  >
                                    <ChevronDown
                                      size={12}
                                      className={`transition-transform ${open ? "rotate-180" : ""}`}
                                    />
                                    diff
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleApprove(server.id, tool.name)}
                                    className="rounded border border-emerald-500/30 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/10"
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
                                className="rounded border border-white/10 bg-transparent px-2 py-1 text-[11px] text-white/70"
                              >
                                <option value="auto">auto</option>
                                <option value="jit">jit</option>
                                <option value="blocked">blocked</option>
                              </select>
                            </div>
                          </div>

                          {open && tool.needsReapproval && (
                            <div className="border-t border-white/5 p-2">
                              <p className="text-[11px] text-red-300/80">
                                Withheld from agents: this tool's definition changed after it was approved.
                                Review the change before re-approving.
                              </p>
                              <DiffRow label="Description" before={tool.approvedDescription} after={tool.description} />
                              <DiffRow
                                label="Input schema"
                                before={pretty(tool.approvedInputSchema)}
                                after={pretty(tool.inputSchema)}
                              />
                              {affected.length > 0 && (
                                <p className="mt-2 text-[11px] text-white/45">
                                  Affects: {affected.map((a) => a.agentName).join(", ")}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </ReflectiveCard>
          );
        })
      )}
    </div>
  );
}

/** One field's before/after when a tool definition drifts. Hidden when unchanged. */
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
      <p className="text-[10px] uppercase tracking-wide text-white/30">{label}</p>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-200/80">
        − {before ?? "(none)"}
      </pre>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200/80">
        + {after ?? "(none)"}
      </pre>
    </div>
  );
}
