"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Mail, Phone, Plug, Server } from "lucide-react";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import {
  disconnectGoogle,
  disconnectWhatsApp,
  getWhatsAppStatus,
  googleConnector,
  listConnectors,
  patchWhatsAppDefaults,
  saveN8nIntegration,
  startGoogleOAuth,
  startWhatsAppLink,
  whatsappConnector,
  type ConnectorsListResponse,
  type WhatsAppLinkStatusDTO,
} from "@/lib/connectors-api";
import { listAgents } from "@/lib/agents-api";
import { listTeams } from "@/lib/teams-api";
import { cn } from "@/lib/utils/cn";

interface ConnectorsViewProps {
  readonly isOrgWorkspace: boolean;
  readonly canManageN8n: boolean;
}

/** Strip JID suffixes like `:64` from stored owner id for display. */
function formatWhatsAppPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/@.*/, "").split(":")[0]?.replace(/\D/g, "") ?? "";
  if (!digits) return raw;
  if (digits.startsWith("91") && digits.length >= 12) {
    return `+91 ${digits.slice(2)}`;
  }
  return `+${digits}`;
}

export function ConnectorsView({ isOrgWorkspace, canManageN8n }: ConnectorsViewProps) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<ConnectorsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [n8nBaseUrl, setN8nBaseUrl] = useState("");
  const [n8nSecret, setN8nSecret] = useState("");
  const [n8nReadPath, setN8nReadPath] = useState("/webhook/qlix-email-read");
  const [n8nSendPath, setN8nSendPath] = useState("/webhook/qlix-email-send");
  const [n8nSaved, setN8nSaved] = useState(false);
  const [waStatus, setWaStatus] = useState<WhatsAppLinkStatusDTO | null>(null);
  const [waPolling, setWaPolling] = useState(false);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [defaultTeamId, setDefaultTeamId] = useState("");
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [defaultsSaving, setDefaultsSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listConnectors();
      setData(res);
      if (res.n8n.n8nBaseUrl) setN8nBaseUrl(res.n8n.n8nBaseUrl);
      setN8nReadPath(res.n8n.n8nEmailReadPath);
      setN8nSendPath(res.n8n.n8nEmailSendPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const pending = data?.connectors.some(
      (c) => c.provider === "whatsapp_baileys" && c.status === "pending_qr",
    );
    if (!pending) return;
    void getWhatsAppStatus()
      .then((s) => {
        setWaStatus(s);
        if (s.status === "pending_qr") setWaPolling(true);
      })
      .catch(() => {});
  }, [data]);

  useEffect(() => {
    if (!waPolling) return;
    const id = setInterval(() => {
      void getWhatsAppStatus()
        .then((s) => {
          setWaStatus(s);
          if (s.status === "connected") {
            setWaPolling(false);
            void refresh();
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [waPolling, refresh]);

  const connected = data ? googleConnector(data.connectors) : undefined;
  const wa = data ? whatsappConnector(data.connectors) : undefined;
  const waConnected = wa?.status === "connected" || waStatus?.status === "connected";
  const oauthError = searchParams.get("error");

  useEffect(() => {
    if (!waConnected) return;
    void listTeams()
      .then((t) => setTeams(t.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
    void listAgents(null)
      .then((a) => setAgents((a ?? []).map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
  }, [waConnected]);

  useEffect(() => {
    if (!wa) return;
    setDefaultTeamId(wa.whatsappDefaultTeamId ?? "");
    setDefaultAgentId(wa.whatsappDefaultAgentId ?? "");
  }, [wa]);
  const oauthSuccess = searchParams.get("connected");

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startGoogleOAuth();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start OAuth");
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectGoogle();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  }

  async function handleWhatsAppConnect() {
    setBusy(true);
    setError(null);
    try {
      const status = await startWhatsAppLink();
      setWaStatus(status);
      setWaPolling(status.status === "pending_qr");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link WhatsApp");
    } finally {
      setBusy(false);
    }
  }

  async function handleWhatsAppDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectWhatsApp();
      setWaStatus(null);
      setWaPolling(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect WhatsApp");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveN8n(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setN8nSaved(false);
    try {
      await saveN8nIntegration({
        n8nBaseUrl,
        n8nWebhookSecret: n8nSecret,
        n8nEmailReadPath: n8nReadPath,
        n8nEmailSendPath: n8nSendPath,
      });
      setN8nSecret("");
      setN8nSaved(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save n8n settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-qlix-fade-in max-w-2xl">
      <div className="flex items-center gap-2">
        <Plug size={18} className="text-indigo-400" />
        <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">Connectors</h1>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[--text-secondary]">
        Connect external services for agent tools. Google OAuth powers{" "}
        <code className="text-[12px]">email.read</code> and <code className="text-[12px]">email.send</code> via
        n8n workflows.
      </p>

      {oauthError && (
        <p className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
          OAuth failed: {oauthError}
        </p>
      )}
      {oauthSuccess === "google" && (
        <p className="mt-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">
          Google account connected
          {searchParams.get("email") ? ` (${searchParams.get("email")})` : ""}.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
          {error}
        </p>
      )}

      <ReflectiveCard className="mt-6 rounded" contentClassName="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-white/5 p-2">
              <Mail size={20} className="text-sky-400" />
            </div>
            <div>
              <h2 className="text-[13px] font-medium text-white/90">Google (Gmail)</h2>
              <p className="mt-1 text-[12px] text-white/45">
                Read and send email through agents. Required before granting email scopes.
              </p>
              {loading ? (
                <p className="mt-2 flex items-center gap-1 text-[12px] text-white/35">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </p>
              ) : connected ? (
                <p className="mt-2 text-[12px] text-emerald-400">
                  Connected as {connected.emailAddress ?? "Google account"}
                </p>
              ) : (
                <p className="mt-2 text-[12px] text-amber-400/90">Not connected</p>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {connected ? (
              <button
                type="button"
                onClick={() => void handleDisconnect()}
                disabled={busy}
                className="rounded border border-white/10 px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/5 disabled:opacity-40"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={busy || loading}
                className="rounded bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                Connect Google
              </button>
            )}
          </div>
        </div>
      </ReflectiveCard>

      <ReflectiveCard className="mt-4 rounded" contentClassName="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-white/5 p-2">
              <Phone size={20} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-[13px] font-medium text-white/90">WhatsApp (Qlix)</h2>
              <p className="mt-1 text-[12px] text-white/45">
                Link your device for JIT approvals, agent commands, and run notifications.
                {isOrgWorkspace ? " One number per organization workspace." : " Personal workspace link."}
              </p>
              {loading ? (
                <p className="mt-2 flex items-center gap-1 text-[12px] text-white/35">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </p>
              ) : waConnected ? (
                <p className="mt-2 text-[12px] text-emerald-400">
                  Connected
                  {formatWhatsAppPhone(wa?.emailAddress ?? waStatus?.phone)
                    ? ` (${formatWhatsAppPhone(wa?.emailAddress ?? waStatus?.phone)})`
                    : ""}
                </p>
              ) : wa?.status === "pending_qr" || waStatus?.status === "pending_qr" ? (
                <p className="mt-2 text-[12px] text-amber-400/90">Scan QR in WhatsApp → Linked devices</p>
              ) : (
                <p className="mt-2 text-[12px] text-amber-400/90">Not connected</p>
              )}
              {waStatus?.qr && (
                <div className="mt-3 inline-block rounded border border-white/10 bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(waStatus.qr)}`}
                    alt="WhatsApp QR code"
                    width={180}
                    height={180}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {waConnected ? (
              <button
                type="button"
                onClick={() => void handleWhatsAppDisconnect()}
                disabled={busy}
                className="rounded border border-white/10 px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/5 disabled:opacity-40"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleWhatsAppConnect()}
                disabled={busy || loading}
                className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Link WhatsApp
              </button>
            )}
          </div>
        </div>
        {waConnected && (
          <div className="mt-4 border-t border-white/8 pt-4 space-y-3">
            <p className="text-[12px] text-white/50">
              Default team for @ commands in self-chat. Teams run only when a message starts with @.
            </p>
            <label className="block">
              <span className="text-[11px] text-white/40">Default team</span>
              <select
                value={defaultTeamId}
                onChange={(e) => setDefaultTeamId(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-[13px] text-white/90"
              >
                <option value="">— None (use @TeamName: only) —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-white/40">Fallback default agent</span>
              <select
                value={defaultAgentId}
                onChange={(e) => setDefaultAgentId(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-[13px] text-white/90"
              >
                <option value="">— None —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={defaultsSaving || busy}
              onClick={() => {
                setDefaultsSaving(true);
                void patchWhatsAppDefaults({
                  teamId: defaultTeamId || null,
                  agentId: defaultAgentId || null,
                })
                  .then(() => refresh())
                  .catch((err) => setError(err instanceof Error ? err.message : "Failed to save defaults"))
                  .finally(() => setDefaultsSaving(false));
              }}
              className="rounded border border-white/10 px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/5 disabled:opacity-40"
            >
              {defaultsSaving ? "Saving…" : "Save WhatsApp defaults"}
            </button>
            <p className="text-[11px] text-white/35 font-mono">
              @ your goal (default team) · @Team Name: goal · !status · !cancel · @ mid-run guidance
            </p>
          </div>
        )}
      </ReflectiveCard>

      {(canManageN8n || isOrgWorkspace) && (
        <ReflectiveCard className="mt-4 rounded" contentClassName="p-5">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-violet-400" />
            <h2 className="text-[13px] font-medium text-white/90">n8n integration</h2>
          </div>
          <p className="mt-1 text-[12px] text-white/45">
            Self-hosted n8n public HTTPS webhooks. Qlix backend proxies agent email tools to these endpoints.
          </p>
          {!canManageN8n && (
            <p className="mt-2 text-[12px] text-white/35">Org admin required to change n8n settings.</p>
          )}
          <form onSubmit={(e) => void handleSaveN8n(e)} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-[11px] text-white/40">Base URL</span>
              <input
                type="url"
                value={n8nBaseUrl}
                onChange={(e) => setN8nBaseUrl(e.target.value)}
                placeholder="https://n8n.example.com"
                disabled={!canManageN8n || busy}
                className="mt-1 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-[13px] text-white/90"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-white/40">Webhook secret (Bearer token)</span>
              <input
                type="password"
                value={n8nSecret}
                onChange={(e) => setN8nSecret(e.target.value)}
                placeholder={data?.n8n.configured ? "•••••••• (leave blank to keep)" : "Shared secret for webhook auth"}
                disabled={!canManageN8n || busy}
                className="mt-1 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-[13px] text-white/90"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-white/40">Read path</span>
                <input
                  type="text"
                  value={n8nReadPath}
                  onChange={(e) => setN8nReadPath(e.target.value)}
                  disabled={!canManageN8n || busy}
                  className="mt-1 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-[12px] font-mono text-white/80"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-white/40">Send path</span>
                <input
                  type="text"
                  value={n8nSendPath}
                  onChange={(e) => setN8nSendPath(e.target.value)}
                  disabled={!canManageN8n || busy}
                  className="mt-1 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-[12px] font-mono text-white/80"
                />
              </label>
            </div>
            {canManageN8n && (
              <button
                type="submit"
                disabled={busy || !n8nBaseUrl || (!n8nSecret && !data?.n8n.configured)}
                className={cn(
                  "rounded bg-violet-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-500 disabled:opacity-40",
                )}
              >
                Save n8n settings
              </button>
            )}
            {n8nSaved && <p className="text-[12px] text-emerald-400">n8n settings saved.</p>}
            {data?.n8n.configured && (
              <p className="text-[12px] text-white/35">n8n is configured for this workspace.</p>
            )}
          </form>
        </ReflectiveCard>
      )}
    </div>
  );
}
