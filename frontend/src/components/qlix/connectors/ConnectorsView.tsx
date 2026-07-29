"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Mail, Phone, Share2 } from "lucide-react";
import {
  SketchBox,
  SketchPageHeader,
  SketchSection,
  sketchButton,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import {
  disconnectGoogle,
  disconnectOrbit,
  disconnectOrbitChannel,
  disconnectWhatsApp,
  enableOrbit,
  getOrbitPlatformStatus,
  getWhatsAppStatus,
  googleConnector,
  listConnectors,
  listOrbitChannels,
  orbitConnector,
  patchWhatsAppDefaults,
  startGoogleOAuth,
  startOrbitSocialOAuth,
  startWhatsAppLink,
  whatsappConnector,
  type ConnectorsListResponse,
  type OrbitChannelDTO,
  type WhatsAppLinkStatusDTO,
} from "@/lib/connectors-api";
import { listAgents } from "@/lib/agents-api";
import { listTeams } from "@/lib/teams-api";
import { WhatsAppQr } from "./WhatsAppQr";
import {
  jitScopeLabel,
  listJitGrants,
  revokeJitGrant,
  type ConversationGrantDTO,
} from "@/lib/jit-api";

interface ConnectorsViewProps {
  readonly isOrgWorkspace: boolean;
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

const selectClass = `${sketchInput} mt-1`;

export function ConnectorsView({ isOrgWorkspace }: ConnectorsViewProps) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<ConnectorsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waStatus, setWaStatus] = useState<WhatsAppLinkStatusDTO | null>(null);
  const [waPolling, setWaPolling] = useState(false);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [defaultTeamId, setDefaultTeamId] = useState("");
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [grants, setGrants] = useState<ConversationGrantDTO[]>([]);
  const [revoking, setRevoking] = useState<Record<string, boolean>>({});
  const [orbitConnecting, setOrbitConnecting] = useState(false);
  const [orbitPlatformConfigured, setOrbitPlatformConfigured] = useState<boolean | null>(null);
  const [orbitChannels, setOrbitChannels] = useState<OrbitChannelDTO[]>([]);
  const [orbitChannelsLoading, setOrbitChannelsLoading] = useState(false);
  const [orbitSocialBusy, setOrbitSocialBusy] = useState<string | null>(null);

  const ORBIT_CONNECT_BUTTONS: Array<{ id: string; label: string }> = [
    { id: "facebook", label: "Facebook" },
    { id: "instagram", label: "Instagram" },
    { id: "x", label: "X (Twitter)" },
    { id: "linkedin", label: "LinkedIn" },
    { id: "youtube", label: "YouTube" },
    { id: "tiktok", label: "TikTok" },
  ];

  const refreshOrbitChannels = useCallback(async () => {
    setOrbitChannelsLoading(true);
    try {
      setOrbitChannels(await listOrbitChannels());
    } catch {
      setOrbitChannels([]);
    } finally {
      setOrbitChannelsLoading(false);
    }
  }, []);

  const refreshGrants = useCallback(async () => {
    try {
      setGrants(await listJitGrants());
    } catch {
      // Non-fatal: the section just stays empty if grants can't be loaded.
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, orbitStatus] = await Promise.all([
        listConnectors(),
        getOrbitPlatformStatus().catch(() => null),
      ]);
      setData(res);
      if (orbitStatus) setOrbitPlatformConfigured(orbitStatus.platformConfigured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshGrants();
  }, [refresh, refreshGrants]);

  useEffect(() => {
    if (!data) return;
    const linked = orbitConnector(data.connectors);
    if (linked) void refreshOrbitChannels();
    else setOrbitChannels([]);
  }, [data, refreshOrbitChannels]);

  async function handleRevokeGrant(grantId: string) {
    setRevoking((p) => ({ ...p, [grantId]: true }));
    try {
      await revokeJitGrant(grantId);
      await refreshGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke session approval");
    } finally {
      setRevoking((p) => ({ ...p, [grantId]: false }));
    }
  }

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
  const orbit = data ? orbitConnector(data.connectors) : undefined;
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
      // Only ever hand the browser off to Google's real OAuth endpoint. Guards against an open
      // redirect if the API response is tampered with (compromised proxy / MITM).
      const parsed = new URL(url);
      const allowedHosts = new Set(["accounts.google.com"]);
      if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
        throw new Error("Unexpected OAuth redirect target");
      }
      window.location.href = parsed.toString();
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

  async function handleOrbitEnable() {
    setOrbitConnecting(true);
    setError(null);
    try {
      await enableOrbit();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable social");
    } finally {
      setOrbitConnecting(false);
    }
  }

  async function handleOrbitDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectOrbit();
      setOrbitChannels([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Orbit");
    } finally {
      setBusy(false);
    }
  }

  async function handleOrbitSocialConnect(integration: string) {
    setOrbitSocialBusy(integration);
    setError(null);
    try {
      const { url } = await startOrbitSocialOAuth(integration);
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Unexpected OAuth redirect target");
      }
      window.location.href = parsed.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start channel connect");
      setOrbitSocialBusy(null);
    }
  }

  async function handleOrbitChannelDisconnect(channelId: string) {
    setBusy(true);
    setError(null);
    try {
      await disconnectOrbitChannel(channelId);
      await refreshOrbitChannels();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect channel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <SketchPageHeader title="Connectors" />
      <p className="-mt-4 mb-6 text-[13px] leading-relaxed text-black/60">
        Connect external services for agent tools. Google powers{" "}
        <code className="text-[12px]">email.read</code> / <code className="text-[12px]">email.send</code>
        ; Orbit powers <code className="text-[12px]">social.read</code> /{" "}
        <code className="text-[12px]">social.publish</code>.
      </p>

      {oauthError ? (
        <SketchBox className="mb-4 px-3 py-2">
          <p className="text-[13px] text-black">OAuth failed: {oauthError}</p>
        </SketchBox>
      ) : null}
      {oauthSuccess === "google" ? (
        <SketchBox className="mb-4 px-3 py-2">
          <p className="text-[13px] text-black">
            Google account connected
            {searchParams.get("email") ? ` (${searchParams.get("email")})` : ""}.
          </p>
        </SketchBox>
      ) : null}
      {error ? (
        <SketchBox className="mb-4 px-3 py-2">
          <p className="text-[13px] text-black">{error}</p>
        </SketchBox>
      ) : null}

      <SketchSection title="Google (Gmail)">
        <SketchBox className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="border border-black p-2">
                <Mail size={20} className="text-black" />
              </div>
              <div>
                <h2 className={sketchLabel}>Gmail</h2>
                <p className="mt-1 text-[12px] text-black/60">
                  Read and send email through agents. Required before granting email scopes.
                </p>
                {loading ? (
                  <p className="mt-2 flex items-center gap-1 text-[12px] text-black/50">
                    <Loader2 size={12} className="animate-spin" /> Loading…
                  </p>
                ) : connected ? (
                  <p className="mt-2 font-serif text-[11px] uppercase text-black">
                    Connected as {connected.emailAddress ?? "Google account"}
                  </p>
                ) : (
                  <p className="mt-2 font-serif text-[11px] uppercase text-black/50">Not connected</p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {connected ? (
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={busy}
                  className={sketchButton}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnect()}
                  disabled={busy || loading}
                  className={sketchButton}
                >
                  Connect Google
                </button>
              )}
            </div>
          </div>
        </SketchBox>
      </SketchSection>

      {grants.length > 0 ? (
        <SketchSection title="Session approvals" className="mt-4">
          <SketchBox className="p-5">
            <p className="mb-3 text-[12px] text-black/60">
              Scopes you approved once for an ongoing agent conversation. They auto-approve
              repeat actions (e.g. sending more email) until you revoke them here or they expire.
            </p>
            <ul className="space-y-2">
              {grants.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between gap-3 border-t border-black/15 pt-2 first:border-t-0 first:pt-0"
                >
                  <div>
                    <p className="text-[13px] text-black">
                      {jitScopeLabel(g.scope)}
                      {g.agentName ? ` · ${g.agentName}` : ""}
                    </p>
                    <p className="font-serif text-[11px] uppercase text-black/50">
                      Approved for this conversation
                      {g.expiresAt ? ` · expires ${new Date(g.expiresAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRevokeGrant(g.id)}
                    disabled={Boolean(revoking[g.id])}
                    className={`${sketchButton} shrink-0`}
                  >
                    {revoking[g.id] ? "Revoking…" : "Revoke"}
                  </button>
                </li>
              ))}
            </ul>
          </SketchBox>
        </SketchSection>
      ) : null}

      <SketchSection title="WhatsApp (Qlix)" className="mt-4">
        <SketchBox className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="border border-black p-2">
                <Phone size={20} className="text-black" />
              </div>
              <div>
                <h2 className={sketchLabel}>WhatsApp</h2>
                <p className="mt-1 text-[12px] text-black/60">
                  Link your device for JIT approvals, agent commands, and run notifications.
                  {isOrgWorkspace ? " One number per organization workspace." : " Personal workspace link."}
                </p>
                {loading ? (
                  <p className="mt-2 flex items-center gap-1 text-[12px] text-black/50">
                    <Loader2 size={12} className="animate-spin" /> Loading…
                  </p>
                ) : waConnected ? (
                  <p className="mt-2 font-serif text-[11px] uppercase text-black">
                    Connected
                    {formatWhatsAppPhone(wa?.emailAddress ?? waStatus?.phone)
                      ? ` (${formatWhatsAppPhone(wa?.emailAddress ?? waStatus?.phone)})`
                      : ""}
                  </p>
                ) : wa?.status === "pending_qr" || waStatus?.status === "pending_qr" ? (
                  <p className="mt-2 font-serif text-[11px] uppercase text-black/50">
                    Scan QR in WhatsApp → Linked devices
                  </p>
                ) : (
                  <p className="mt-2 font-serif text-[11px] uppercase text-black/50">Not connected</p>
                )}
                {waStatus?.qr ? (
                  <div className="mt-3 inline-block border border-black bg-white p-2">
                    <WhatsAppQr data={waStatus.qr} size={180} />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="shrink-0">
              {waConnected ? (
                <button
                  type="button"
                  onClick={() => void handleWhatsAppDisconnect()}
                  disabled={busy}
                  className={sketchButton}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleWhatsAppConnect()}
                  disabled={busy || loading}
                  className={sketchButton}
                >
                  Link WhatsApp
                </button>
              )}
            </div>
          </div>
          {waConnected ? (
            <div className="mt-4 space-y-3 border-t border-black pt-4">
              <p className="text-[12px] text-black/60">
                Default team for @ commands in self-chat. Teams run only when a message starts with @.
              </p>
              <label className="block">
                <span className={sketchLabel}>Default team</span>
                <select
                  value={defaultTeamId}
                  onChange={(e) => setDefaultTeamId(e.target.value)}
                  className={selectClass}
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
                <span className={sketchLabel}>Fallback default agent</span>
                <select
                  value={defaultAgentId}
                  onChange={(e) => setDefaultAgentId(e.target.value)}
                  className={selectClass}
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
                className={sketchButton}
              >
                {defaultsSaving ? "Saving…" : "Save WhatsApp defaults"}
              </button>
              <p className="font-mono text-[11px] text-black/40">
                @ your goal (default team) · @Team Name: goal · !status · !cancel · @ mid-run guidance
              </p>
            </div>
          ) : null}
        </SketchBox>
      </SketchSection>

      <SketchSection title="Orbit by Exora" className="mt-4">
        <SketchBox className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="border border-black p-2">
                <Share2 size={20} className="text-black" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className={sketchLabel}>Social scheduling</h2>
                <p className="mt-1 text-[12px] text-black/60">
                  Enable social for this workspace, then connect Instagram, Facebook, X, and more.
                  Channels stay isolated per workspace. Agents use{" "}
                  <code className="text-[11px]">social.read</code> /{" "}
                  <code className="text-[11px]">social.publish</code>.
                </p>
                {loading ? (
                  <p className="mt-2 flex items-center gap-1 text-[12px] text-black/50">
                    <Loader2 size={12} className="animate-spin" /> Loading…
                  </p>
                ) : orbit ? (
                  <p className="mt-2 font-serif text-[11px] uppercase text-black">
                    Social enabled
                    {orbit.emailAddress ? ` · ${orbit.emailAddress}` : ""}
                  </p>
                ) : orbitPlatformConfigured === false ? (
                  <p className="mt-2 text-[12px] text-black/50">
                    Social is not configured on this server yet (ops: set ORBIT_API_KEY).
                  </p>
                ) : (
                  <p className="mt-2 font-serif text-[11px] uppercase text-black/50">Not enabled</p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {orbit ? (
                <button
                  type="button"
                  onClick={() => void handleOrbitDisconnect()}
                  disabled={busy}
                  className={sketchButton}
                >
                  Disable social
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleOrbitEnable()}
                  disabled={
                    orbitConnecting ||
                    busy ||
                    loading ||
                    orbitPlatformConfigured === false
                  }
                  className={sketchButton}
                >
                  {orbitConnecting ? "Enabling…" : "Enable social"}
                </button>
              )}
            </div>
          </div>

          {orbit ? (
            <div className="mt-4 space-y-4 border-t border-black pt-4">
              <div>
                <p className={sketchLabel}>Connect a channel</p>
                <p className="mt-1 mb-2 text-[12px] text-black/60">
                  Opens the platform login (Meta, X, …). You return to Qlix after approving — refresh
                  channels if the list does not update immediately.
                </p>
                <div className="flex flex-wrap gap-2">
                  {ORBIT_CONNECT_BUTTONS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy || orbitSocialBusy !== null}
                      onClick={() => void handleOrbitSocialConnect(p.id)}
                      className={sketchButton}
                    >
                      {orbitSocialBusy === p.id ? "Starting…" : `Connect ${p.label}`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className={sketchLabel}>Connected channels</p>
                  <button
                    type="button"
                    className={sketchButton}
                    disabled={orbitChannelsLoading || busy}
                    onClick={() => void refreshOrbitChannels()}
                  >
                    {orbitChannelsLoading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
                {orbitChannelsLoading && orbitChannels.length === 0 ? (
                  <p className="flex items-center gap-1 text-[12px] text-black/50">
                    <Loader2 size={12} className="animate-spin" /> Loading channels…
                  </p>
                ) : orbitChannels.length === 0 ? (
                  <p className="text-[12px] text-black/50">
                    No channels yet. Connect Instagram, Facebook, or X above.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {orbitChannels.map((ch) => (
                      <li
                        key={ch.id}
                        className="flex items-center justify-between gap-3 border-t border-black/15 pt-2 first:border-t-0 first:pt-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-black">{ch.name}</p>
                          <p className="font-serif text-[11px] uppercase text-black/50">
                            {ch.identifier}
                            {ch.profile ? ` · @${ch.profile}` : ""}
                            {ch.disabled ? " · disabled" : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          className={`${sketchButton} shrink-0`}
                          disabled={busy}
                          onClick={() => void handleOrbitChannelDisconnect(ch.id)}
                        >
                          Disconnect
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </SketchBox>
      </SketchSection>
    </div>
  );
}
