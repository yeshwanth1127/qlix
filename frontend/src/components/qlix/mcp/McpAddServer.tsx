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
import { MCP_CATALOG, type McpCatalogEntry } from "@/lib/mcpCatalog";
import {
  createMcpServer,
  setMcpOAuthConfig,
  startMcpOAuth,
  type CreateMcpServerInput,
  type McpTransport,
} from "@/lib/mcp-api";
import { SketchBox, sketchButton, sketchInput, sketchLabel } from "@/components/qlix/sketch";

const ICONS: Record<McpCatalogEntry["icon"], LucideIcon> = {
  github: GitBranch,
  slack: MessagesSquare,
  linear: SquareKanban,
  notion: NotebookText,
  postgres: Database,
  filesystem: FolderOpen,
  google: Mail,
};

interface McpAddServerProps {
  readonly onDone: () => void;
  readonly onCancel: () => void;
}

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
    <SketchBox className="mt-4 p-5">
      <div className="flex items-center justify-between">
        <p className={sketchLabel}>Add an integration</p>
        <button type="button" onClick={onCancel} className={sketchButton}>
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
              className="flex items-start gap-3 border border-black p-3 text-left transition-colors hover:bg-black/5"
            >
              <div className="border border-black p-2">
                <Icon size={18} className="text-black" />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-black">
                  {entry.name}{" "}
                  <span className="text-[10px] uppercase tracking-wide text-black/40">{entry.category}</span>
                  {entry.auth === "oauth" && (
                    <span className="ml-1 inline-flex items-center gap-0.5 border border-black px-1 py-0.5 text-[9px] text-black">
                      <ShieldCheck size={9} /> OAuth
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-black/50">{entry.blurb}</p>
              </div>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onPick("custom")}
          className="flex items-start gap-3 border border-dashed border-black p-3 text-left transition-colors hover:bg-black/5"
        >
          <div className="border border-black p-2">
            <Plug size={18} className="text-black/60" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-black">Custom server</p>
            <p className="mt-0.5 text-[11px] leading-snug text-black/50">
              Paste any MCP endpoint URL or local command.
            </p>
          </div>
        </button>
      </div>
    </SketchBox>
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
      if (cfg || clientId.trim() || clientSecret.trim()) {
        await setMcpOAuthConfig(server.id, {
          ...cfg,
          clientId: clientId.trim() || undefined,
          clientSecret: clientSecret.trim() || undefined,
        });
      }
      const url = await startMcpOAuth(server.id);
      window.open(url, "qlix-mcp-oauth", "width=620,height=760");
      onDone();
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
    <SketchBox className="mt-4 p-5">
      <button type="button" onClick={onBack} className={`${sketchButton} gap-1`}>
        <ArrowLeft size={13} /> Back
      </button>

      {entry?.reviewNote && (
        <SketchBox className="mt-3 px-3 py-2 text-[11px] leading-relaxed text-black/70">
          {entry.reviewNote}
          {entry.docsUrl && (
            <>
              {" "}
              <a href={entry.docsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Docs ↗
              </a>
            </>
          )}
        </SketchBox>
      )}

      {error && (
        <SketchBox className="mt-3 px-3 py-2 text-[12px] text-black">{error}</SketchBox>
      )}

      <div className="mt-3 space-y-3">
        {!entry && (
          <div className="flex gap-2">
            {(["http", "stdio"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTransport(t)}
                className={`${sketchButton} ${transport === t ? "bg-black text-white hover:bg-black hover:text-white" : ""}`}
              >
                {t === "http" ? "Remote (HTTP)" : "Local (stdio)"}
              </button>
            ))}
          </div>
        )}

        <label className="block text-[12px] text-black/70">
          Name
          <input className={`${sketchInput} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Linear" />
        </label>

        {transport === "http" ? (
          <label className="block text-[12px] text-black/70">
            Endpoint URL
            <input
              className={`${sketchInput} mt-1`}
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://mcp.example.com/sse"
            />
          </label>
        ) : (
          <>
            <label className="block text-[12px] text-black/70">
              Command
              <input className={`${sketchInput} mt-1`} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
            </label>
            <label className="block text-[12px] text-black/70">
              Arguments (space-separated)
              <input
                className={`${sketchInput} mt-1`}
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-filesystem /data"
              />
            </label>
            <p className="text-[11px] text-black/50">
              Local (stdio) servers run on the agent&apos;s local app and are discovered when it connects.
            </p>
          </>
        )}

        {isOAuth ? (
          <>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className={sketchButton}>
              {showAdvanced ? "Hide" : "Advanced:"} client ID / secret
            </button>
            {showAdvanced && (
              <div className="space-y-2">
                <input className={sketchInput} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" />
                <input
                  className={sketchInput}
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
              className={`${sketchButton} gap-1.5 disabled:opacity-40`}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              Connect {entry?.name ?? "account"}
            </button>
          </>
        ) : (
          <>
            {fields.map((f) => (
              <label key={f.key} className="block text-[12px] text-black/70">
                {f.label}
                {f.required ? <span className="text-black"> *</span> : <span className="text-black/40"> (optional)</span>}
                <input
                  className={`${sketchInput} mt-1`}
                  type="password"
                  autoComplete="off"
                  value={secrets[f.key] ?? ""}
                  onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
                <span className="mt-1 block font-mono text-[10px] text-black/40">
                  {f.kind === "header" ? `header ${f.key}` : `env ${f.key}`}
                </span>
              </label>
            ))}

            {!entry && transport === "http" && (
              <label className="block text-[12px] text-black/70">
                Authorization header (optional)
                <input
                  className={`${sketchInput} mt-1`}
                  type="password"
                  autoComplete="off"
                  value={customAuth}
                  onChange={(e) => setCustomAuth(e.target.value)}
                  placeholder="Bearer sk-..."
                />
              </label>
            )}

            <button type="button" onClick={submitToken} disabled={busy || !canSubmit} className={`${sketchButton} disabled:opacity-40`}>
              {busy ? "Registering…" : "Register & discover"}
            </button>
          </>
        )}
      </div>
    </SketchBox>
  );
}
