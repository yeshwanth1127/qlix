"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Database,
  FolderOpen,
  GitBranch,
  Loader2,
  Mail,
  MessagesSquare,
  NotebookText,
  Plug,
  ShieldCheck,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import { MCP_CATALOG, type McpCatalogEntry } from "@/lib/mcpCatalog";
import {
  createMcpServer,
  setMcpOAuthConfig,
  startMcpOAuth,
  type CreateMcpServerInput,
  type McpTransport,
} from "@/lib/mcp-api";

const ICONS: Record<McpCatalogEntry["icon"], LucideIcon> = {
  github: GitBranch,
  slack: MessagesSquare,
  linear: SquareKanban,
  notion: NotebookText,
  postgres: Database,
  filesystem: FolderOpen,
  google: Mail,
};

const inputCls =
  "mt-1 w-full rounded border border-white/10 bg-transparent px-3 py-1.5 text-[12px] text-white/80 outline-none focus:border-indigo-500";

interface McpAddServerProps {
  /** Called after a server is created (token path) or the OAuth popup is launched. */
  readonly onDone: () => void;
  readonly onCancel: () => void;
}

/** Add-server flow: pick a curated integration (or Custom URL), then a prefilled connect form. */
export function McpAddServer({ onDone, onCancel }: McpAddServerProps) {
  const [picked, setPicked] = useState<McpCatalogEntry | "custom" | null>(null);

  if (picked === null) {
    return <Gallery onPick={setPicked} onCancel={onCancel} />;
  }
  return <ConnectForm entry={picked === "custom" ? null : picked} onDone={onDone} onBack={() => setPicked(null)} />;
}

function Gallery({
  onPick,
  onCancel,
}: {
  readonly onPick: (v: McpCatalogEntry | "custom") => void;
  readonly onCancel: () => void;
}) {
  return (
    <ReflectiveCard className="mt-4 rounded" contentClassName="p-5">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-white/70">Add an integration</p>
        <button type="button" onClick={onCancel} className="text-[12px] text-white/45 hover:text-white/70">
          Cancel
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {MCP_CATALOG.map((entry) => {
          const Icon = ICONS[entry.icon];
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onPick(entry)}
              className="flex items-start gap-3 rounded-md border border-white/10 p-3 text-left hover:border-indigo-500/40 hover:bg-white/5"
            >
              <div className="rounded-lg bg-white/5 p-2">
                <Icon size={18} className={entry.accent} />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-white/85">
                  {entry.name}{" "}
                  <span className="text-[10px] uppercase tracking-wide text-white/30">{entry.category}</span>
                  {entry.auth === "oauth" && (
                    <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] text-emerald-300">
                      <ShieldCheck size={9} /> OAuth
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-white/45">{entry.blurb}</p>
              </div>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onPick("custom")}
          className="flex items-start gap-3 rounded-md border border-dashed border-white/15 p-3 text-left hover:border-indigo-500/40 hover:bg-white/5"
        >
          <div className="rounded-lg bg-white/5 p-2">
            <Plug size={18} className="text-white/60" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-white/85">Custom server</p>
            <p className="mt-0.5 text-[11px] leading-snug text-white/45">
              Paste any MCP endpoint URL or local command.
            </p>
          </div>
        </button>
      </div>
    </ReflectiveCard>
  );
}

function ConnectForm({
  entry,
  onDone,
  onBack,
}: {
  readonly entry: McpCatalogEntry | null;
  readonly onDone: () => void;
  readonly onBack: () => void;
}) {
  const isOAuth = entry?.auth === "oauth";
  const [transport, setTransport] = useState<McpTransport>(entry?.transport ?? "http");
  const [name, setName] = useState(entry?.name ?? "");
  const [endpointUrl, setEndpointUrl] = useState(entry?.endpointUrl ?? "");
  const [command, setCommand] = useState(entry?.command ?? "");
  const [args, setArgs] = useState((entry?.args ?? []).join(" "));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [customAuth, setCustomAuth] = useState("");
  // OAuth manual client (only for providers without dynamic registration).
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = entry?.secretFields ?? [];
  const missingRequired = useMemo(
    () => fields.some((f) => f.required && !(secrets[f.key] ?? "").trim()),
    [fields, secrets],
  );

  function buildBaseInput(): CreateMcpServerInput {
    return {
      name: name.trim(),
      transport,
      endpointUrl: transport === "http" ? endpointUrl.trim() : undefined,
      command: transport === "stdio" ? command.trim() : undefined,
      args:
        transport === "stdio" ? args.split(/\s+/).map((a) => a.trim()).filter(Boolean) : undefined,
    };
  }

  async function submitToken() {
    setBusy(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      const env: Record<string, string> = {};
      for (const f of fields) {
        const raw = (secrets[f.key] ?? "").trim();
        if (!raw) continue;
        const value = `${f.prefix ?? ""}${raw}`;
        if (f.kind === "header") headers[f.key] = value;
        else env[f.key] = value;
      }
      if (!entry && customAuth.trim()) headers["Authorization"] = customAuth.trim();
      await createMcpServer({
        ...buildBaseInput(),
        headers: Object.keys(headers).length ? headers : undefined,
        env: Object.keys(env).length ? env : undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register server");
      setBusy(false);
    }
  }

  async function connectOAuth() {
    setBusy(true);
    setError(null);
    try {
      const server = await createMcpServer({ ...buildBaseInput(), transport: "http", authType: "oauth" });
      const cfg = entry?.oauthConfig;
      // Apply pre-filled config (Google etc.) and/or manually-entered client credentials.
      if (cfg || clientId.trim() || clientSecret.trim()) {
        await setMcpOAuthConfig(server.id, {
          ...cfg,
          clientId: clientId.trim() || undefined,
          clientSecret: clientSecret.trim() || undefined,
        });
      }
      const url = await startMcpOAuth(server.id);
      window.open(url, "qlix-mcp-oauth", "width=620,height=760");
      onDone(); // list refreshes now; the popup posts a message on success to refresh again
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start OAuth");
      setBusy(false);
    }
  }

  const canSubmit =
    Boolean(name.trim()) &&
    (transport === "http" ? Boolean(endpointUrl.trim()) : Boolean(command.trim())) &&
    (isOAuth || !missingRequired);

  return (
    <ReflectiveCard className="mt-4 rounded" contentClassName="p-5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-[12px] text-white/45 hover:text-white/75"
      >
        <ArrowLeft size={13} /> Back
      </button>

      {entry?.reviewNote && (
        <p className="mt-3 rounded border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          {entry.reviewNote}
          {entry.docsUrl && (
            <>
              {" "}
              <a
                href={entry.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-amber-400/40 underline-offset-2 hover:text-amber-100"
              >
                Docs ↗
              </a>
            </>
          )}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</p>
      )}

      <div className="mt-3 space-y-3">
        {!entry && (
          <div className="flex gap-2">
            {(["http", "stdio"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTransport(t)}
                className={`rounded px-3 py-1.5 text-[12px] ${
                  transport === t ? "bg-indigo-600 text-white" : "border border-white/10 text-white/60"
                }`}
              >
                {t === "http" ? "Remote (HTTP)" : "Local (stdio)"}
              </button>
            ))}
          </div>
        )}

        <label className="block text-[12px] text-white/60">
          Name
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Linear" />
        </label>

        {transport === "http" ? (
          <label className="block text-[12px] text-white/60">
            Endpoint URL
            <input
              className={inputCls}
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://mcp.example.com/sse"
            />
          </label>
        ) : (
          <>
            <label className="block text-[12px] text-white/60">
              Command
              <input className={inputCls} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
            </label>
            <label className="block text-[12px] text-white/60">
              Arguments (space-separated)
              <input
                className={inputCls}
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-filesystem /data"
              />
            </label>
            <p className="text-[11px] text-white/35">
              Local (stdio) servers run on the agent's hybrid runner and are discovered when it connects.
            </p>
          </>
        )}

        {isOAuth ? (
          <>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[11px] text-white/40 hover:text-white/70"
            >
              {showAdvanced ? "Hide" : "Advanced:"} client ID / secret (only if the provider can't auto-register)
            </button>
            {showAdvanced && (
              <div className="space-y-2">
                <input
                  className={inputCls}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Client ID"
                />
                <input
                  className={inputCls}
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Client secret (if confidential)"
                />
              </div>
            )}
            <button
              type="button"
              onClick={connectOAuth}
              disabled={busy || !name.trim() || !endpointUrl.trim()}
              className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              Connect {entry?.name ?? "account"}
            </button>
          </>
        ) : (
          <>
            {fields.map((f) => (
              <label key={f.key} className="block text-[12px] text-white/60">
                {f.label}
                {f.required ? (
                  <span className="text-red-300/70"> *</span>
                ) : (
                  <span className="text-white/30"> (optional)</span>
                )}
                <input
                  className={inputCls}
                  type="password"
                  autoComplete="off"
                  value={secrets[f.key] ?? ""}
                  onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
                <span className="mt-1 block font-mono text-[10px] text-white/30">
                  {f.kind === "header" ? `header ${f.key}` : `env ${f.key}`}
                </span>
              </label>
            ))}

            {!entry && transport === "http" && (
              <label className="block text-[12px] text-white/60">
                Authorization header (optional)
                <input
                  className={inputCls}
                  type="password"
                  autoComplete="off"
                  value={customAuth}
                  onChange={(e) => setCustomAuth(e.target.value)}
                  placeholder="Bearer sk-..."
                />
              </label>
            )}

            <button
              type="button"
              onClick={submitToken}
              disabled={busy || !canSubmit}
              className="rounded bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? "Registering…" : "Register & discover"}
            </button>
          </>
        )}
      </div>
    </ReflectiveCard>
  );
}
