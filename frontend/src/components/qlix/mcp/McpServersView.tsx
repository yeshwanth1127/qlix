"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Unplug,
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
  type McpServerStatus,
  type McpServerToolDTO,
} from "@/lib/mcp-api";
import { sketchLabel } from "@/components/qlix/sketch";
import {
  ConnectorAlert,
  ConnectorPanel,
  ConnectorRow,
  SectionHeading,
  type ConnectorStatus,
} from "@/components/qlix/connectors/connector-ui";

function toolStatus(tool: McpServerToolDTO): { label: string; Icon: LucideIcon; tone: string } {
  if (tool.defaultGovernance === "blocked") {
    return { label: "Blocked", Icon: ShieldOff, tone: "connector-tag--danger" };
  }
  if (tool.needsReapproval) {
    return { label: "Withheld", Icon: ShieldAlert, tone: "connector-tag--warn" };
  }
  return { label: "Approved", Icon: ShieldCheck, tone: "" };
}

const SERVER_STATUS: Record<McpServerStatus, ConnectorStatus> = {
  connected: "connected",
  error: "error",
  revoked: "idle",
  pending: "pending",
};

const SERVER_STATUS_LABEL: Record<McpServerStatus, string> = {
  connected: "Connected",
  error: "Needs attention",
  revoked: "Disconnected",
  pending: "Waiting",
};

function pretty(value: Record<string, unknown> | null): string | null {
  return value ? JSON.stringify(value, null, 2) : null;
}

export function McpServersView({ embedded = false }: { readonly embedded?: boolean }) {
  const [servers, setServers] = useState<McpServerDTO[]>([]);
  const [agentsByServer, setAgentsByServer] = useState<Record<string, McpServerAgentDTO[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const [openServer, setOpenServer] = useState<string | null>(null);

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
    <section className={embedded ? "w-full max-w-none" : "mt-12 w-full max-w-none"}>
      {embedded ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="connector-meta">Extra tool sets your agents can use.</p>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="connector-action connector-action--quiet"
          >
            {showForm ? "Cancel" : "Add server"}
          </button>
        </div>
      ) : (
        <SectionHeading
          title="MCP servers"
          hint="Extra tool sets your agents can use."
          right={
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="connector-action connector-action--quiet"
            >
              {showForm ? "Cancel" : "Add server"}
            </button>
          }
        />
      )}

      {error ? (
        <ConnectorAlert variant="error" className="mb-3">
          {error}
        </ConnectorAlert>
      ) : null}

      {showForm && (
        <div className="mb-3">
          <McpAddServer
            onDone={() => {
              setShowForm(false);
              void refresh();
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <ConnectorPanel>
        {loading ? (
          <p className="connector-meta flex items-center gap-2 px-5 py-6">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </p>
        ) : servers.length === 0 ? (
          <p className="connector-meta px-5 py-6">
            No servers yet — add one to give your agents extra tools.
          </p>
        ) : (
          servers.map((server) => {
            const boundAgents = agentsByServer[server.id] ?? [];
            const tools = server.tools ?? [];
            const withheld = tools.filter((t) => t.needsReapproval).length;
            const open = openServer === server.id;
            const address = server.endpointUrl ?? server.command ?? "";

            return (
              <ConnectorRow
                key={server.id}
                icon={
                  <span className="connector-glyph">
                    <Server size={18} />
                  </span>
                }
                name={server.name}
                status={SERVER_STATUS[server.status]}
                statusLabel={SERVER_STATUS_LABEL[server.status]}
                expandable
                expanded={open}
                onToggle={() => setOpenServer(open ? null : server.id)}
                meta={
                  <>
                    {tools.length} tool{tools.length === 1 ? "" : "s"}
                    {withheld > 0 ? ` · ${withheld} withheld` : ""}
                    {boundAgents.length > 0
                      ? ` · used by ${boundAgents.map((a) => a.agentName).join(", ")}`
                      : ""}
                  </>
                }
              >
                <div className="space-y-4">
                  {address ? <p className="connector-code font-mono">{address}</p> : null}
                  {server.lastError ? (
                    <p className="text-[12px] text-[color:var(--sketch-red)]">{server.lastError}</p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1.5">
                    {server.authType === "oauth" && (
                      <button
                        type="button"
                        onClick={() => void handleReconnect(server.id)}
                        disabled={busyId === server.id}
                        className="connector-action connector-action--quiet"
                      >
                        <KeyRound size={12} />
                        {server.oauthConnected ? "Reconnect" : "Connect account"}
                      </button>
                    )}
                    {server.authType === "oauth" && server.oauthConnected && (
                      <button
                        type="button"
                        onClick={() => void handleDisconnect(server.id)}
                        disabled={busyId === server.id}
                        className="connector-action connector-action--quiet"
                      >
                        <Unplug size={12} />
                        Disconnect
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDiscover(server.id)}
                      disabled={busyId === server.id}
                      className="connector-action connector-action--quiet"
                    >
                      {busyId === server.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                      Refresh tools
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId((id) => (id === server.id ? null : server.id))}
                      className="connector-action connector-action--quiet"
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(server.id)}
                      disabled={busyId === server.id}
                      className="connector-action connector-action--quiet ml-auto"
                    >
                      <Trash2 size={12} />
                      Remove
                    </button>
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

                  {tools.length > 0 && (
                    <div>
                      <p className={sketchLabel}>Tools</p>
                      <ul className="connector-sublist connector-sublist--stack mt-1">
                        {tools.map((tool) => {
                          const status = toolStatus(tool);
                          const key = `${server.id}:${tool.name}`;
                          const diffOpen = openDiff === key;
                          const affected = boundAgents.filter(
                            (a) => a.allowedTools.includes("*") || a.allowedTools.includes(tool.name),
                          );
                          return (
                            <li key={tool.id}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-[13px] text-black">{tool.name}</p>
                                  {tool.description ? (
                                    <p className="connector-meta truncate">{tool.description}</p>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <span className={`connector-tag ${status.tone}`}>
                                    <status.Icon size={10} /> {status.label}
                                  </span>
                                  {tool.needsReapproval && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => setOpenDiff(diffOpen ? null : key)}
                                        className="connector-action connector-action--quiet"
                                      >
                                        <ChevronDown
                                          size={12}
                                          className={`transition-transform ${diffOpen ? "rotate-180" : ""}`}
                                        />
                                        Changes
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleApprove(server.id, tool.name)}
                                        className="connector-action connector-action--quiet"
                                      >
                                        Re-approve
                                      </button>
                                    </>
                                  )}
                                  <select
                                    value={tool.defaultGovernance}
                                    onChange={(e) =>
                                      void handleGovernance(
                                        server.id,
                                        tool.name,
                                        e.target.value as McpGovernance,
                                      )
                                    }
                                    aria-label={`Approval rule for ${tool.name}`}
                                    className="connector-select connector-select--inline"
                                  >
                                    <option value="auto">Always allow</option>
                                    <option value="jit">Ask me</option>
                                    <option value="blocked">Never</option>
                                  </select>
                                </div>
                              </div>

                              {diffOpen && tool.needsReapproval && (
                                <div className="mt-2">
                                  <p className="connector-meta">
                                    Held back from agents — this tool changed after you approved it.
                                  </p>
                                  <DiffRow
                                    label="Description"
                                    before={tool.approvedDescription}
                                    after={tool.description}
                                  />
                                  <DiffRow
                                    label="Inputs"
                                    before={pretty(tool.approvedInputSchema)}
                                    after={pretty(tool.inputSchema)}
                                  />
                                  {affected.length > 0 && (
                                    <p className="connector-meta mt-2">
                                      Affects {affected.map((a) => a.agentName).join(", ")}
                                    </p>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </ConnectorRow>
            );
          })
        )}
      </ConnectorPanel>
    </section>
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
      <pre className="connector-code mt-1 font-mono">− {before ?? "(none)"}</pre>
      <pre className="connector-code connector-code--after mt-1 font-mono">+ {after ?? "(none)"}</pre>
    </div>
  );
}
