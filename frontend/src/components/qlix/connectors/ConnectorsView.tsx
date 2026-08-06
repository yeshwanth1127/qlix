"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Share2 } from "lucide-react";
import {
  SketchPageHeader,
  SketchSection,
  sketchButton,
  sketchButtonPrimary,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import {
  disconnectGoogle,
  disconnectOrbit,
  disconnectOrbitChannel,
  disconnectSlack,
  disconnectWhatsApp,
  disconnectZoho,
  enableOrbit,
  getOrbitPlatformStatus,
  getWhatsAppStatus,
  googleConnector,
  listConnectors,
  listOrbitChannels,
  orbitConnector,
  patchWhatsAppDefaults,
  slackConnector,
  startGoogleOAuth,
  startOrbitSocialOAuth,
  startSlackOAuth,
  startWhatsAppLink,
  startZohoOAuth,
  whatsappConnector,
  zohoConnector,
  type ConnectorsListResponse,
  type OrbitChannelDTO,
  type WhatsAppLinkStatusDTO,
} from "@/lib/connectors-api";
import {
  CONNECTOR_CATALOG_ENTRIES,
  getCatalogEntry,
  ZOHO_SUITE_CATALOG_IDS,
} from "@/lib/connector-catalog";
import { cn } from "@/lib/utils/cn";
import { listAgents } from "@/lib/agents-api";
import { listTeams } from "@/lib/teams-api";
import { WhatsAppQr } from "./WhatsAppQr";
import { ConnectorCatalogSection } from "./ConnectorCatalogSection";
import { ConnectorLogo } from "./ConnectorLogo";
import {
  ConnectorAlert,
  ConnectorCard,
  ConnectorStatusBadge,
  ConnectorsStatsStrip,
} from "./connector-ui";
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
  const [slackBusy, setSlackBusy] = useState(false);
  const [grants, setGrants] = useState<ConversationGrantDTO[]>([]);
  const [revoking, setRevoking] = useState<Record<string, boolean>>({});
  const [orbitConnecting, setOrbitConnecting] = useState(false);
  const [orbitPlatformConfigured, setOrbitPlatformConfigured] = useState<boolean | null>(null);
  const [orbitChannels, setOrbitChannels] = useState<OrbitChannelDTO[]>([]);
  const [orbitChannelsLoading, setOrbitChannelsLoading] = useState(false);
  const [orbitSocialBusy, setOrbitSocialBusy] = useState<string | null>(null);

  const ORBIT_CONNECT_BUTTONS = [
    "facebook",
    "instagram",
    "x",
    "linkedin",
    "youtube",
    "tiktok",
  ] as const;

  const googleLogo = getCatalogEntry("google")!.logo;
  const whatsappLogo = getCatalogEntry("whatsapp")!.logo;
  const slackLogo = getCatalogEntry("slack")!.logo;

  const zohoSuite = ZOHO_SUITE_CATALOG_IDS.map((id) => getCatalogEntry(id)).filter(
    (entry): entry is NonNullable<typeof entry> => entry != null,
  );

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
    const timer = window.setTimeout(() => {
      void refresh();
      void refreshGrants();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh, refreshGrants]);

  useEffect(() => {
    if (!data) return;
    const linked = orbitConnector(data.connectors);
    const timer = window.setTimeout(() => {
      if (linked) void refreshOrbitChannels();
      else setOrbitChannels([]);
    }, 0);
    return () => window.clearTimeout(timer);
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
  const zoho = data ? zohoConnector(data.connectors) : undefined;
  const slack = data ? slackConnector(data.connectors) : undefined;
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
    const timer = window.setTimeout(() => {
      setDefaultTeamId(wa.whatsappDefaultTeamId ?? "");
      setDefaultAgentId(wa.whatsappDefaultAgentId ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [wa]);
  const oauthSuccess = searchParams.get("connected");
  const neededProviders = new Set(
    (searchParams.get("needed") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const needsGoogle = neededProviders.has("google") && !connected;
  const needsZoho = neededProviders.has("zoho") && !zoho;
  const needsWhatsApp = neededProviders.has("whatsapp_baileys") && !waConnected;
  const needsOrbit = neededProviders.has("orbit") && !orbit;

  const connectedCount = [connected, zoho, waConnected, orbit].filter(Boolean).length;
  const totalLive = 4;

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
      window.location.assign(parsed.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start OAuth");
      setBusy(false);
    }
  }

  async function handleZohoConnect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startZohoOAuth();
      const parsed = new URL(url);
      const allowedHosts = new Set([
        "accounts.zoho.com",
        "accounts.zoho.in",
        "accounts.zoho.eu",
        "accounts.zoho.com.au",
        "accounts.zoho.jp",
        "accounts.zoho.sa",
        "accounts.zoho.uk",
      ]);
      if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
        throw new Error("Unexpected OAuth redirect target");
      }
      window.location.assign(parsed.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Zoho OAuth");
      setBusy(false);
    }
  }

  async function handleZohoDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectZoho();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Zoho");
    } finally {
      setBusy(false);
    }
  }

  async function handleSlackConnect() {
    setSlackBusy(true);
    setError(null);
    try {
      const { url } = await startSlackOAuth();
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "slack.com") {
        throw new Error("Unexpected OAuth redirect target");
      }
      window.location.assign(parsed.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Slack OAuth");
      setSlackBusy(false);
    }
  }

  async function handleSlackDisconnect() {
    setSlackBusy(true);
    setError(null);
    try {
      await disconnectSlack();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Slack");
    } finally {
      setSlackBusy(false);
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
      setWaPolling(status.status === "pending_qr" && !status.qr ? true : status.status === "pending_qr");
      await refresh();
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
      window.location.assign(parsed.toString());
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
    <div className="w-full max-w-none animate-qlix-fade-in">
      <SketchPageHeader title="Connectors" />
      <p className="-mt-4 mb-5 max-w-2xl text-[13px] leading-relaxed text-black/70">
        Connect services for agent tools. Zoho CRM is live; Mail, Books, Desk, Inventory, and
        Projects are listed below. Browse the platform catalog for more OAuth/API integrations.
      </p>

      <ConnectorsStatsStrip
        connectedCount={connectedCount}
        totalLive={totalLive}
        catalogCount={CONNECTOR_CATALOG_ENTRIES.length}
        loading={loading}
      />

      <div className="mb-4 space-y-2">
        {oauthError ? (
          <ConnectorAlert variant="error">OAuth failed: {oauthError}</ConnectorAlert>
        ) : null}
        {oauthSuccess === "google" ? (
          <ConnectorAlert variant="success">
            Google account connected
            {searchParams.get("email") ? ` (${searchParams.get("email")})` : ""}.
          </ConnectorAlert>
        ) : null}
        {oauthSuccess === "zoho" ? (
          <ConnectorAlert variant="success">
            Zoho CRM connected
            {searchParams.get("email") ? ` (${searchParams.get("email")})` : ""}.
          </ConnectorAlert>
        ) : null}
        {oauthSuccess === "slack" ? (
          <ConnectorAlert variant="success">
            Slack connected
            {searchParams.get("email") ? ` (${searchParams.get("email")})` : ""}. Agents with{" "}
            <span className="font-medium">slack.read</span> /{" "}
            <span className="font-medium">slack.send</span> will act as this Slack user.
          </ConnectorAlert>
        ) : null}
        {neededProviders.size > 0 && (needsGoogle || needsZoho || needsWhatsApp || needsOrbit) ? (
          <ConnectorAlert variant="warning">
            Your new agent needs{" "}
            {[
              needsGoogle ? "Gmail" : null,
              needsZoho ? "Zoho CRM" : null,
              needsWhatsApp ? "WhatsApp" : null,
              needsOrbit ? "Orbit" : null,
            ]
              .filter(Boolean)
              .join(", ")}
            . Connect below to unlock those tools.
          </ConnectorAlert>
        ) : null}
        {error ? <ConnectorAlert variant="error">{error}</ConnectorAlert> : null}
      </div>

      <SketchSection title="Google (Gmail)" id="connector-google">
        <ConnectorCard
          connected={Boolean(connected)}
          highlight={needsGoogle}
          staggerIndex={0}
          className="p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ConnectorLogo name="Google" logo={googleLogo} size="lg" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className={sketchLabel}>Gmail</h2>
                  {!loading && connected ? (
                    <ConnectorStatusBadge status="connected" />
                  ) : !loading ? (
                    <ConnectorStatusBadge status="idle" />
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] text-black/60">
                  Read and send email through agents. Required before granting email scopes.
                </p>
                {loading ? (
                  <p className="mt-2 flex items-center gap-1 text-[12px] text-black/50">
                    <Loader2 size={12} className="animate-spin" /> Loading…
                  </p>
                ) : connected ? (
                  <p className="mt-2 text-[12px] text-black/70">
                    Connected as{" "}
                    <span className="font-medium text-black">
                      {connected.emailAddress ?? "Google account"}
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-[12px] text-black/50">Not connected</p>
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
                  className={sketchButtonPrimary}
                >
                  Connect Google
                </button>
              )}
            </div>
          </div>
        </ConnectorCard>
      </SketchSection>

      {grants.length > 0 ? (
        <SketchSection title="Session approvals" className="mt-4">
          <ConnectorCard className="p-5" staggerIndex={1}>
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
          </ConnectorCard>
        </SketchSection>
      ) : null}

      <SketchSection title="WhatsApp (Qlix)" className="mt-4" id="connector-whatsapp">
        <ConnectorCard
          connected={waConnected}
          highlight={needsWhatsApp}
          staggerIndex={2}
          className="p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ConnectorLogo name="WhatsApp" logo={whatsappLogo} size="lg" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className={sketchLabel}>WhatsApp</h2>
                  {!loading && waConnected ? (
                    <ConnectorStatusBadge status="connected" />
                  ) : !loading && (wa?.status === "pending_qr" || waStatus?.status === "pending_qr") ? (
                    <ConnectorStatusBadge status="pending" label="Scan QR" />
                  ) : !loading ? (
                    <ConnectorStatusBadge status="idle" />
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] text-black/60">
                  Link your device for JIT approvals, agent commands, and run notifications.
                  Message yourself on WhatsApp — just type naturally; Qlix picks the agent.
                  {isOrgWorkspace ? " One number per organization workspace." : " Personal workspace link."}
                </p>
                {loading ? (
                  <p className="mt-2 flex items-center gap-1 text-[12px] text-black/50">
                    <Loader2 size={12} className="animate-spin" /> Loading…
                  </p>
                ) : waConnected ? (
                  <p className="mt-2 text-[12px] text-black/70">
                    Linked
                    {formatWhatsAppPhone(wa?.emailAddress ?? waStatus?.phone)
                      ? ` · ${formatWhatsAppPhone(wa?.emailAddress ?? waStatus?.phone)}`
                      : ""}
                  </p>
                ) : wa?.status === "pending_qr" || waStatus?.status === "pending_qr" ? (
                  <p className="mt-2 text-[12px] text-[#b45309]">
                    Scan QR in WhatsApp → Linked devices
                  </p>
                ) : (
                  <p className="mt-2 text-[12px] text-black/50">Not connected</p>
                )}
                {waStatus?.qr ? (
                  <div className="mt-3 inline-block overflow-hidden rounded-xl border border-black/15 bg-white p-3 shadow-[0_8px_24px_-12px_rgba(16,14,22,0.2)]">
                    <WhatsAppQr data={waStatus.qr} size={180} />
                  </div>
                ) : wa?.status === "pending_qr" || waStatus?.status === "pending_qr" ? (
                  <div
                    className="mt-3 flex items-center justify-center rounded-xl border border-dashed border-black/20 bg-white/80 p-2 text-[11px] text-black/50"
                    style={{ width: 180 + 24, height: 180 + 24 }}
                  >
                    <span className="flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" aria-hidden />
                      Generating QR…
                    </span>
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
                  className={sketchButtonPrimary}
                >
                  Link WhatsApp
                </button>
              )}
            </div>
          </div>
          {waConnected ? (
            <div className="mt-4 space-y-3 border-t border-black/10 pt-4">
              <p className="text-[12px] text-black/60">
                Default team for @ commands in self-chat. Plain text routes to an agent automatically.
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
                <span className={sketchLabel}>WhatsApp default agent</span>
                <select
                  value={defaultAgentId}
                  onChange={(e) => setDefaultAgentId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">— None (intent routing picks) —</option>
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
                Plain text → agent · @TeamName: goal · !help · !status · !cancel
              </p>
            </div>
          ) : null}
        </ConnectorCard>
      </SketchSection>

      <SketchSection title="Slack" className="mt-4" id="connector-slack">
        <ConnectorCard
          connected={Boolean(slack)}
          staggerIndex={3}
          className="p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ConnectorLogo name="Slack" logo={slackLogo} size="lg" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className={sketchLabel}>Slack</h2>
                  {slack ? (
                    <ConnectorStatusBadge status="connected" />
                  ) : (
                    <ConnectorStatusBadge status="idle" />
                  )}
                </div>
                <p className="mt-1 text-[12px] text-black/60">
                  Connect with OAuth so agents read channels and post messages as the signed-in Slack
                  user. Grant agents <span className="font-medium text-black">slack.read</span> and{" "}
                  <span className="font-medium text-black">slack.send</span> scopes.
                </p>
                {slack ? (
                  <p className="mt-2 text-[12px] text-black/70">
                    Connected as{" "}
                    <span className="font-medium text-black">
                      {slack.emailAddress ?? "Slack workspace"}
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-[12px] text-black/50">Not connected</p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {slack ? (
                <button
                  type="button"
                  onClick={() => void handleSlackDisconnect()}
                  disabled={slackBusy}
                  className={sketchButton}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  disabled={slackBusy}
                  className={sketchButtonPrimary}
                  onClick={() => void handleSlackConnect()}
                >
                  {slackBusy ? "Connecting…" : "Connect Slack"}
                </button>
              )}
            </div>
          </div>
        </ConnectorCard>
      </SketchSection>

      <SketchSection title="Zoho" id="connector-zoho" className="mt-4">
        <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-black/70">
          Connect Zoho apps for agent tools. CRM is live today; Mail, Books, Desk, Inventory, and
          Projects are coming soon.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {zohoSuite.map((entry, idx) => {
            const isCrm = entry.id === "zoho";
            const isLive = entry.availability === "live";
            const highlight = isCrm && needsZoho;
            return (
              <ConnectorCard
                key={entry.id}
                connected={isCrm && Boolean(zoho)}
                highlight={highlight}
                staggerIndex={3 + idx}
                className="p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <ConnectorLogo name={entry.name} logo={entry.logo} size="md" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-black">
                          {entry.name}
                        </h2>
                        {isCrm && !loading && zoho ? (
                          <ConnectorStatusBadge status="connected" />
                        ) : isCrm && !loading ? (
                          <ConnectorStatusBadge status="idle" />
                        ) : null}
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em]",
                            isLive
                              ? "bg-[color:var(--sketch-green-soft)] text-[color:var(--sketch-green)]"
                              : "bg-black/[0.04] text-black/45",
                          )}
                        >
                          {isLive ? "Live" : "Coming soon"}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-black">
                        {entry.description}
                      </p>
                      {isCrm && loading ? (
                        <p className="mt-2 flex items-center gap-1 text-[12px] text-black">
                          <Loader2 size={12} className="animate-spin" /> Loading…
                        </p>
                      ) : isCrm && zoho ? (
                        <p className="mt-2 text-[12px] text-black/70">
                          Connected as{" "}
                          <span className="font-medium text-black">
                            {zoho.emailAddress ?? "Zoho account"}
                          </span>
                        </p>
                      ) : isCrm ? (
                        <p className="mt-2 text-[12px] text-black/50">Not connected</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isCrm && zoho ? (
                      <button
                        type="button"
                        onClick={() => void handleZohoDisconnect()}
                        disabled={busy}
                        className={sketchButton}
                      >
                        Disconnect
                      </button>
                    ) : isCrm ? (
                      <button
                        type="button"
                        onClick={() => void handleZohoConnect()}
                        disabled={busy || loading}
                        className={sketchButtonPrimary}
                      >
                        Connect
                      </button>
                    ) : (
                      <button type="button" disabled className={`${sketchButton} opacity-50`}>
                        Soon
                      </button>
                    )}
                  </div>
                </div>
              </ConnectorCard>
            );
          })}
        </div>
      </SketchSection>

      <ConnectorCatalogSection />

      <SketchSection title="Social scheduling" className="mt-6" id="connector-orbit">
        <ConnectorCard
          connected={Boolean(orbit)}
          highlight={needsOrbit}
          staggerIndex={8}
          className="p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-gradient-to-br from-[color:var(--sketch-purple-soft)] to-white transition-transform duration-300 group-hover:scale-105">
                <Share2 size={22} className="text-[color:var(--sketch-purple)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className={sketchLabel}>Orbit by Exora</h2>
                  {!loading && orbit ? (
                    <ConnectorStatusBadge status="connected" label="Enabled" />
                  ) : !loading ? (
                    <ConnectorStatusBadge status="idle" />
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] text-black/60">
                  Enable social for this workspace, then connect Instagram, Facebook, X, LinkedIn,
                  and more. Channels stay isolated per workspace. Agents use{" "}
                  <code className="text-[11px]">social.read</code> /{" "}
                  <code className="text-[11px]">social.publish</code>.
                </p>
                {loading ? (
                  <p className="mt-2 flex items-center gap-1 text-[12px] text-black/50">
                    <Loader2 size={12} className="animate-spin" /> Loading…
                  </p>
                ) : orbit ? (
                  <p className="mt-2 text-[12px] text-black/70">
                    Social enabled
                    {orbit.emailAddress ? ` · ${orbit.emailAddress}` : ""}
                  </p>
                ) : orbitPlatformConfigured === false ? (
                  <p className="mt-2 text-[12px] text-black/50">
                    Social is not configured on this server yet (ops: set ORBIT_API_KEY).
                  </p>
                ) : (
                  <p className="mt-2 text-[12px] text-black/50">Not enabled</p>
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
                  className={sketchButtonPrimary}
                >
                  {orbitConnecting ? "Enabling…" : "Enable social"}
                </button>
              )}
            </div>
          </div>

          {orbit ? (
            <div className="mt-4 space-y-4 border-t border-black/10 pt-4">
              <div>
                <p className={sketchLabel}>Connect a channel</p>
                <p className="mt-1 mb-3 text-[12px] text-black/60">
                  Opens the platform login. You return to Qlix after approving — refresh channels if
                  the list does not update immediately.
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {ORBIT_CONNECT_BUTTONS.map((id) => {
                    const entry = getCatalogEntry(id);
                    if (!entry) return null;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={busy || orbitSocialBusy !== null}
                        onClick={() => void handleOrbitSocialConnect(id)}
                        className={`${sketchButton} sketch-card-hover !justify-start gap-2.5 !normal-case !tracking-normal`}
                      >
                        <ConnectorLogo name={entry.name} logo={entry.logo} size="sm" />
                        <span className="text-[12px] font-medium">
                          {orbitSocialBusy === id ? "Starting…" : entry.name}
                        </span>
                      </button>
                    );
                  })}
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
        </ConnectorCard>
      </SketchSection>
    </div>
  );
}
