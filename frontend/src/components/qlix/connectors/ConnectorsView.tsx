"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Share2 } from "lucide-react";
import { SketchPageHeader, sketchLabel } from "@/components/qlix/sketch";
import {
  disconnectGoogle,
  disconnectGoogleService,
  disconnectOrbit,
  disconnectOrbitChannel,
  connectTelegramBot,
  disconnectDiscord,
  disconnectGitHub,
  disconnectMicrosoft,
  disconnectNotion,
  disconnectSlack,
  disconnectTelegram,
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
  discordConnector,
  githubConnector,
  microsoftConnector,
  notionConnector,
  slackConnector,
  telegramConnector,
  startDiscordOAuth,
  startGitHubOAuth,
  startGoogleOAuth,
  startMicrosoftOAuth,
  startNotionOAuth,
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
import { getCatalogEntry } from "@/lib/connector-catalog";
import {
  GOOGLE_SERVICES,
  connectedGoogleServiceCount,
  googleServiceConnected,
  type GoogleServiceId,
} from "@/lib/google-services";
import { listAgents } from "@/lib/agents-api";
import { listTeams } from "@/lib/teams-api";
import { WhatsAppQr } from "./WhatsAppQr";
import { ConnectorCatalogSection } from "./ConnectorCatalogSection";
import { ConnectorLogo } from "./ConnectorLogo";
import {
  ConnectorAlert,
  ConnectorPanel,
  ConnectorRow,
  ConnectorStatusDot,
  ConnectorsSummary,
  SectionHeading,
  type ConnectorStatus,
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

const ORBIT_CONNECT_BUTTONS = [
  "facebook",
  "instagram",
  "x",
  "linkedin",
  "youtube",
  "tiktok",
] as const;

const selectClass = "connector-select";

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
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramAgentId, setTelegramAgentId] = useState("");
  const [discordBusy, setDiscordBusy] = useState(false);
  const [githubBusy, setGithubBusy] = useState(false);
  const [microsoftBusy, setMicrosoftBusy] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  const [grants, setGrants] = useState<ConversationGrantDTO[]>([]);
  const [revoking, setRevoking] = useState<Record<string, boolean>>({});
  const [orbitConnecting, setOrbitConnecting] = useState(false);
  const [orbitPlatformConfigured, setOrbitPlatformConfigured] = useState<boolean | null>(null);
  const [orbitChannels, setOrbitChannels] = useState<OrbitChannelDTO[]>([]);
  const [orbitChannelsLoading, setOrbitChannelsLoading] = useState(false);
  const [orbitSocialBusy, setOrbitSocialBusy] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState<string | null>(null);
  /** Accordion — at most one connector shows its settings at a time. Google open by default so services are visible. */
  const [openRow, setOpenRow] = useState<string | null>("google");

  const googleLogo = getCatalogEntry("google")!.logo;
  const whatsappLogo = getCatalogEntry("whatsapp")!.logo;
  const slackLogo = getCatalogEntry("slack")!.logo;
  const telegramLogo = getCatalogEntry("telegram")!.logo;
  const discordLogo = getCatalogEntry("discord")!.logo;
  const githubLogo = getCatalogEntry("github")!.logo;
  const microsoftLogo = getCatalogEntry("microsoft365")!.logo;
  const notionLogo = getCatalogEntry("notion")!.logo;
  const zohoLogo = getCatalogEntry("zoho")!.logo;

  const toggleRow = useCallback((id: string) => {
    setOpenRow((cur) => (cur === id ? null : id));
  }, []);

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
  const telegram = data ? telegramConnector(data.connectors) : undefined;
  const discord = data ? discordConnector(data.connectors) : undefined;
  const github = data ? githubConnector(data.connectors) : undefined;
  const microsoft = data ? microsoftConnector(data.connectors) : undefined;
  const notion = data ? notionConnector(data.connectors) : undefined;
  const wa = data ? whatsappConnector(data.connectors) : undefined;
  const orbit = data ? orbitConnector(data.connectors) : undefined;
  const waConnected = wa?.status === "connected" || waStatus?.status === "connected";
  const waPending = wa?.status === "pending_qr" || waStatus?.status === "pending_qr";
  const oauthError = searchParams.get("error");

  useEffect(() => {
    if (!waConnected && !telegram && openRow !== "telegram") return;
    void listTeams()
      .then((t) => setTeams(t.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
    void listAgents(null)
      .then((a) => setAgents((a ?? []).map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
  }, [waConnected, telegram, openRow]);

  useEffect(() => {
    if (!telegram) return;
    const timer = window.setTimeout(() => {
      setTelegramAgentId(telegram.whatsappDefaultAgentId ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [telegram]);

  useEffect(() => {
    if (!wa) return;
    const timer = window.setTimeout(() => {
      setDefaultTeamId(wa.whatsappDefaultTeamId ?? "");
      setDefaultAgentId(wa.whatsappDefaultAgentId ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [wa]);

  /** Reveal the pairing code the moment linking starts — including a link that
   *  was already pending when the page loaded. Adjusting state during render is
   *  the supported way to react to a changed value without an effect. */
  const [wasWaPending, setWasWaPending] = useState(false);
  if (waPending !== wasWaPending) {
    setWasWaPending(waPending);
    if (waPending) setOpenRow("whatsapp");
  }

  const oauthSuccess = searchParams.get("connected");
  const neededProviders = new Set(
    (searchParams.get("needed") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // Open the Google card when returning from OAuth or when an agent needs Google.
  useEffect(() => {
    if (oauthSuccess === "google" || neededProviders.has("google")) {
      setOpenRow("google");
    }
    // Only react to the URL flags, not the Set identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional URL-driven open
  }, [oauthSuccess, searchParams]);
  const googleScopes = connected?.scopes ?? [];
  const googleServiceCount = connectedGoogleServiceCount(googleScopes);
  const anyGoogleService = googleServiceCount > 0;
  const needsGoogle = neededProviders.has("google") && !anyGoogleService;
  const needsZoho = neededProviders.has("zoho") && !zoho;
  const needsWhatsApp = neededProviders.has("whatsapp_baileys") && !waConnected;
  const needsOrbit = neededProviders.has("orbit") && !orbit;

  const connectedCount = [
    anyGoogleService,
    waConnected,
    slack,
    telegram,
    discord,
    github,
    microsoft,
    notion,
    zoho,
    orbit,
  ].filter(Boolean).length;
  const totalLive = 10;

  function rowStatus(isOn: boolean, isPending = false): ConnectorStatus {
    if (isOn) return "connected";
    return isPending ? "pending" : "idle";
  }

  async function handleGoogleServiceConnect(service: GoogleServiceId) {
    setGoogleBusy(service);
    setError(null);
    try {
      const { url } = await startGoogleOAuth(service);
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
      setGoogleBusy(null);
    }
  }

  async function handleGoogleServiceDisconnect(service: GoogleServiceId) {
    setGoogleBusy(service);
    setError(null);
    try {
      await disconnectGoogleService(service);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Google service");
    } finally {
      setGoogleBusy(null);
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

  async function handleTelegramConnect() {
    setTelegramBusy(true);
    setError(null);
    try {
      await connectTelegramBot({
        defaultAgentId: telegramAgentId || null,
      });
      setOpenRow(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Telegram");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function handleTelegramDisconnect() {
    setTelegramBusy(true);
    setError(null);
    try {
      await disconnectTelegram();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Telegram");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function handleDiscordConnect() {
    setDiscordBusy(true);
    setError(null);
    try {
      const { url } = await startDiscordOAuth();
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "discord.com") {
        throw new Error("Unexpected OAuth redirect target");
      }
      window.location.assign(parsed.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Discord OAuth");
      setDiscordBusy(false);
    }
  }

  async function handleDiscordDisconnect() {
    setDiscordBusy(true);
    setError(null);
    try {
      await disconnectDiscord();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Discord");
    } finally {
      setDiscordBusy(false);
    }
  }

  async function handleGitHubConnect() {
    setGithubBusy(true);
    setError(null);
    try {
      const { url } = await startGitHubOAuth();
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
        throw new Error("Unexpected OAuth redirect target");
      }
      window.location.assign(parsed.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start GitHub OAuth");
      setGithubBusy(false);
    }
  }

  async function handleGitHubDisconnect() {
    setGithubBusy(true);
    setError(null);
    try {
      await disconnectGitHub();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect GitHub");
    } finally {
      setGithubBusy(false);
    }
  }

  async function handleMicrosoftConnect() {
    setMicrosoftBusy(true);
    setError(null);
    try {
      const { url } = await startMicrosoftOAuth();
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" ||
        (parsed.hostname !== "login.microsoftonline.com" &&
          !parsed.hostname.endsWith(".microsoftonline.com"))
      ) {
        throw new Error("Unexpected OAuth redirect target");
      }
      window.location.assign(parsed.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Microsoft OAuth");
      setMicrosoftBusy(false);
    }
  }

  async function handleMicrosoftDisconnect() {
    setMicrosoftBusy(true);
    setError(null);
    try {
      await disconnectMicrosoft();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Microsoft 365");
    } finally {
      setMicrosoftBusy(false);
    }
  }

  async function handleNotionConnect() {
    setNotionBusy(true);
    setError(null);
    try {
      const { url } = await startNotionOAuth();
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "api.notion.com") {
        throw new Error("Unexpected OAuth redirect target");
      }
      window.location.assign(parsed.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Notion OAuth");
      setNotionBusy(false);
    }
  }

  async function handleNotionDisconnect() {
    setNotionBusy(true);
    setError(null);
    try {
      await disconnectNotion();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Notion");
    } finally {
      setNotionBusy(false);
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
      setOpenRow("whatsapp");
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
      setOpenRow("orbit");
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

  const waPhone = formatWhatsAppPhone(wa?.emailAddress ?? waStatus?.phone);
  const alerts = [
    oauthError ? <ConnectorAlert key="err" variant="error">Couldn&apos;t finish connecting: {oauthError}</ConnectorAlert> : null,
    oauthSuccess === "google" ? (
      <ConnectorAlert key="ok-google" variant="success">
        {(() => {
          const svc = searchParams.get("service");
          const label =
            GOOGLE_SERVICES.find((s) => s.id === svc)?.label ?? "Google";
          return `${label} connected${searchParams.get("email") ? ` · ${searchParams.get("email")}` : ""}.`;
        })()}
      </ConnectorAlert>
    ) : null,
    oauthSuccess === "zoho" ? (
      <ConnectorAlert key="ok-zoho" variant="success">
        Zoho CRM connected{searchParams.get("email") ? ` · ${searchParams.get("email")}` : ""}.
      </ConnectorAlert>
    ) : null,
    oauthSuccess === "slack" ? (
      <ConnectorAlert key="ok-slack" variant="success">
        Slack connected{searchParams.get("email") ? ` · ${searchParams.get("email")}` : ""}.
      </ConnectorAlert>
    ) : null,
    oauthSuccess === "discord" ? (
      <ConnectorAlert key="ok-discord" variant="success">
        Discord connected{searchParams.get("email") ? ` · ${searchParams.get("email")}` : ""}.
      </ConnectorAlert>
    ) : null,
    oauthSuccess === "github" ? (
      <ConnectorAlert key="ok-github" variant="success">
        GitHub connected{searchParams.get("email") ? ` · ${searchParams.get("email")}` : ""}.
      </ConnectorAlert>
    ) : null,
    oauthSuccess === "microsoft" ? (
      <ConnectorAlert key="ok-microsoft" variant="success">
        Microsoft 365 connected{searchParams.get("email") ? ` · ${searchParams.get("email")}` : ""}.
      </ConnectorAlert>
    ) : null,
    oauthSuccess === "notion" ? (
      <ConnectorAlert key="ok-notion" variant="success">
        Notion connected{searchParams.get("email") ? ` · ${searchParams.get("email")}` : ""}.
      </ConnectorAlert>
    ) : null,
    neededProviders.size > 0 && (needsGoogle || needsZoho || needsWhatsApp || needsOrbit) ? (
      <ConnectorAlert key="needed" variant="warning">
        Your new agent needs{" "}
        {[
          needsGoogle ? "Google" : null,
          needsZoho ? "Zoho CRM" : null,
          needsWhatsApp ? "WhatsApp" : null,
          needsOrbit ? "Social" : null,
        ]
          .filter(Boolean)
          .join(", ")}
        .
      </ConnectorAlert>
    ) : null,
    error ? <ConnectorAlert key="error" variant="error">{error}</ConnectorAlert> : null,
  ].filter(Boolean);

  return (
    <div className="w-full max-w-none animate-qlix-fade-in">
      <SketchPageHeader
        title="Connectors"
        subtitle="Give your agents access to the apps you already use."
        actions={
          <ConnectorsSummary connected={connectedCount} total={totalLive} loading={loading} />
        }
      />

      {alerts.length > 0 ? <div className="mb-5 space-y-2">{alerts}</div> : null}

      <ConnectorPanel>
        {/* Google — one card, each product connects on its own */}
        <ConnectorRow
          id="connector-google"
          icon={<ConnectorLogo name="Google" logo={googleLogo} size="md" />}
          name="Google"
          status={loading ? undefined : rowStatus(anyGoogleService)}
          statusLabel={
            anyGoogleService
              ? `${googleServiceCount} of ${GOOGLE_SERVICES.length}`
              : undefined
          }
          highlight={needsGoogle}
          expandable
          expanded={openRow === "google"}
          onToggle={() => toggleRow("google")}
          meta={
            loading ? (
              <LoadingMeta />
            ) : anyGoogleService ? (
              connected?.emailAddress
                ? `${connected.emailAddress} · ${googleServiceCount} service${googleServiceCount === 1 ? "" : "s"}`
                : `${googleServiceCount} service${googleServiceCount === 1 ? "" : "s"} connected`
            ) : (
              "Gmail, Drive, Calendar, GMeet, YouTube"
            )
          }
          action={
            anyGoogleService ? (
              <QuietAction onClick={() => void handleDisconnect()} disabled={busy || googleBusy !== null}>
                Disconnect all
              </QuietAction>
            ) : null
          }
        >
          <ul className="connector-sublist">
            {GOOGLE_SERVICES.map((svc) => {
              const on = googleServiceConnected(svc.id, googleScopes);
              const logo =
                svc.id === "youtube"
                  ? getCatalogEntry("youtube")?.logo
                  : googleLogo;
              const busySvc = googleBusy === svc.id;
              return (
                <li key={svc.id}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    {logo ? (
                      <ConnectorLogo name={svc.label} logo={logo} size="sm" />
                    ) : null}
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-[13px] text-black">
                        {svc.label}
                        <ConnectorStatusDot
                          status={on ? "connected" : "idle"}
                          label={on ? "Connected" : "Not connected"}
                        />
                      </p>
                      <p className="connector-meta truncate">{svc.description}</p>
                    </div>
                  </div>
                  {on ? (
                    <QuietAction
                      disabled={busy || busySvc}
                      onClick={() => void handleGoogleServiceDisconnect(svc.id)}
                    >
                      {busySvc ? "…" : "Disconnect"}
                    </QuietAction>
                  ) : (
                    <PrimaryAction
                      disabled={busy || loading || googleBusy !== null}
                      onClick={() => void handleGoogleServiceConnect(svc.id)}
                    >
                      {busySvc ? "Opening…" : "Connect"}
                    </PrimaryAction>
                  )}
                </li>
              );
            })}
          </ul>
        </ConnectorRow>

        {/* WhatsApp */}
        <ConnectorRow
          id="connector-whatsapp"
          icon={<ConnectorLogo name="WhatsApp" logo={whatsappLogo} size="md" />}
          name="WhatsApp"
          status={loading ? undefined : rowStatus(waConnected, waPending)}
          statusLabel={waPending && !waConnected ? "Scan the code" : undefined}
          highlight={needsWhatsApp}
          expandable={waConnected || waPending}
          expanded={openRow === "whatsapp"}
          onToggle={() => toggleRow("whatsapp")}
          meta={
            loading ? (
              <LoadingMeta />
            ) : waConnected ? (
              (waPhone ?? "Linked")
            ) : waPending ? (
              "Scan the code in WhatsApp › Linked devices"
            ) : (
              "Chat with your agents and approve actions"
            )
          }
          action={
            waConnected ? (
              <QuietAction onClick={() => void handleWhatsAppDisconnect()} disabled={busy}>
                Disconnect
              </QuietAction>
            ) : (
              <PrimaryAction onClick={() => void handleWhatsAppConnect()} disabled={busy || loading}>
                {waPending ? "Restart" : "Link"}
              </PrimaryAction>
            )
          }
        >
          {waPending && !waConnected ? (
            <div className="flex flex-col items-center gap-3 py-1">
              {waStatus?.qr ? (
                <div className="connector-qr">
                  <WhatsAppQr data={waStatus.qr} size={172} />
                </div>
              ) : (
                <div
                  className="connector-qr connector-qr--empty"
                  style={{ width: 172 + 26, height: 172 + 26 }}
                >
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                </div>
              )}
              <p className="connector-meta text-center">
                WhatsApp › Settings › Linked devices › Link a device
                {isOrgWorkspace ? " · one number per workspace" : ""}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={sketchLabel}>Default team</span>
                  <select
                    value={defaultTeamId}
                    onChange={(e) => setDefaultTeamId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">None</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={sketchLabel}>Default agent</span>
                  <select
                    value={defaultAgentId}
                    onChange={(e) => setDefaultAgentId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Choose automatically</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="connector-meta">
                  Message yourself on WhatsApp — plain text reaches an agent, <code>@Team:</code>{" "}
                  reaches a team.
                </p>
                <QuietAction
                  disabled={defaultsSaving || busy}
                  onClick={() => {
                    setDefaultsSaving(true);
                    void patchWhatsAppDefaults({
                      teamId: defaultTeamId || null,
                      agentId: defaultAgentId || null,
                    })
                      .then(() => refresh())
                      .catch((err) =>
                        setError(err instanceof Error ? err.message : "Failed to save defaults"),
                      )
                      .finally(() => setDefaultsSaving(false));
                  }}
                >
                  {defaultsSaving ? "Saving…" : "Save"}
                </QuietAction>
              </div>
            </div>
          )}
        </ConnectorRow>

        {/* Slack */}
        <ConnectorRow
          id="connector-slack"
          icon={<ConnectorLogo name="Slack" logo={slackLogo} size="md" />}
          name="Slack"
          status={loading ? undefined : rowStatus(Boolean(slack))}
          meta={
            loading ? (
              <LoadingMeta />
            ) : slack ? (
              (slack.emailAddress ?? "Slack workspace")
            ) : (
              "Read channels and post messages"
            )
          }
          action={
            slack ? (
              <QuietAction onClick={() => void handleSlackDisconnect()} disabled={slackBusy}>
                Disconnect
              </QuietAction>
            ) : (
              <PrimaryAction onClick={() => void handleSlackConnect()} disabled={slackBusy}>
                {slackBusy ? "Opening…" : "Connect"}
              </PrimaryAction>
            )
          }
        />

        {/* Telegram */}
        <ConnectorRow
          id="connector-telegram"
          icon={<ConnectorLogo name="Telegram" logo={telegramLogo} size="md" />}
          name="Telegram"
          status={loading ? undefined : rowStatus(Boolean(telegram))}
          expandable
          expanded={openRow === "telegram"}
          onToggle={() => toggleRow("telegram")}
          meta={
            loading ? (
              <LoadingMeta />
            ) : telegram ? (
              (telegram.emailAddress ?? "Telegram bot")
            ) : (
              "DM a bot — agent replies in Telegram"
            )
          }
          action={
            telegram ? (
              <QuietAction onClick={() => void handleTelegramDisconnect()} disabled={telegramBusy}>
                Disconnect
              </QuietAction>
            ) : (
              <PrimaryAction
                onClick={() => {
                  setOpenRow("telegram");
                }}
                disabled={telegramBusy || loading}
              >
                Connect
              </PrimaryAction>
            )
          }
        >
          {telegram ? (
            <div className="space-y-3">
              <p className="connector-meta">
                Connected as {telegram.emailAddress ?? "bot"}. Default agent:{" "}
                {agents.find((a) => a.id === (telegram.whatsappDefaultAgentId ?? ""))?.name ??
                  (telegram.whatsappDefaultAgentId ? telegram.whatsappDefaultAgentId : "none (intent picker)")}
                . Disconnect and reconnect to change the default.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-black/60">
                  Default agent (optional)
                </span>
                <select
                  className={selectClass}
                  value={telegramAgentId}
                  onChange={(e) => setTelegramAgentId(e.target.value)}
                >
                  <option value="">None — show agent picker when needed</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="connector-meta">
                  Uses the server Telegram bot. Without a default, Qlix lists agents and you reply with a number.
                </p>
                <PrimaryAction
                  onClick={() => void handleTelegramConnect()}
                  disabled={telegramBusy}
                >
                  {telegramBusy ? "Connecting…" : "Save & connect"}
                </PrimaryAction>
              </div>
            </div>
          )}
        </ConnectorRow>

        {/* Microsoft 365 */}
        <ConnectorRow
          id="connector-microsoft"
          icon={<ConnectorLogo name="Microsoft 365" logo={microsoftLogo} size="md" />}
          name="Microsoft 365"
          status={loading ? undefined : rowStatus(Boolean(microsoft))}
          meta={
            loading ? (
              <LoadingMeta />
            ) : microsoft ? (
              (microsoft.emailAddress ?? "Microsoft 365 account")
            ) : (
              "Outlook, calendar, and OneDrive"
            )
          }
          action={
            microsoft ? (
              <QuietAction
                onClick={() => void handleMicrosoftDisconnect()}
                disabled={microsoftBusy}
              >
                Disconnect
              </QuietAction>
            ) : (
              <PrimaryAction
                onClick={() => void handleMicrosoftConnect()}
                disabled={microsoftBusy}
              >
                {microsoftBusy ? "Opening…" : "Connect"}
              </PrimaryAction>
            )
          }
        />

        {/* Notion */}
        <ConnectorRow
          id="connector-notion"
          icon={<ConnectorLogo name="Notion" logo={notionLogo} size="md" />}
          name="Notion"
          status={loading ? undefined : rowStatus(Boolean(notion))}
          meta={
            loading ? (
              <LoadingMeta />
            ) : notion ? (
              (notion.emailAddress ?? "Notion workspace")
            ) : (
              "Pages and databases"
            )
          }
          action={
            notion ? (
              <QuietAction onClick={() => void handleNotionDisconnect()} disabled={notionBusy}>
                Disconnect
              </QuietAction>
            ) : (
              <PrimaryAction onClick={() => void handleNotionConnect()} disabled={notionBusy}>
                {notionBusy ? "Opening…" : "Connect"}
              </PrimaryAction>
            )
          }
        />

        {/* Discord */}
        <ConnectorRow
          id="connector-discord"
          icon={<ConnectorLogo name="Discord" logo={discordLogo} size="md" />}
          name="Discord"
          status={loading ? undefined : rowStatus(Boolean(discord))}
          meta={
            loading ? (
              <LoadingMeta />
            ) : discord ? (
              (discord.emailAddress ?? "Discord account")
            ) : (
              "Identity, email, and guilds"
            )
          }
          action={
            discord ? (
              <QuietAction onClick={() => void handleDiscordDisconnect()} disabled={discordBusy}>
                Disconnect
              </QuietAction>
            ) : (
              <PrimaryAction onClick={() => void handleDiscordConnect()} disabled={discordBusy}>
                {discordBusy ? "Opening…" : "Connect"}
              </PrimaryAction>
            )
          }
        />

        {/* GitHub */}
        <ConnectorRow
          id="connector-github"
          icon={<ConnectorLogo name="GitHub" logo={githubLogo} size="md" />}
          name="GitHub"
          status={loading ? undefined : rowStatus(Boolean(github))}
          meta={
            loading ? (
              <LoadingMeta />
            ) : github ? (
              (github.emailAddress ?? "GitHub account")
            ) : (
              "Repos, issues, and pull requests"
            )
          }
          action={
            github ? (
              <QuietAction onClick={() => void handleGitHubDisconnect()} disabled={githubBusy}>
                Disconnect
              </QuietAction>
            ) : (
              <PrimaryAction onClick={() => void handleGitHubConnect()} disabled={githubBusy}>
                {githubBusy ? "Opening…" : "Connect"}
              </PrimaryAction>
            )
          }
        />

        {/* Zoho CRM */}
        <ConnectorRow
          id="connector-zoho"
          icon={<ConnectorLogo name="Zoho" logo={zohoLogo} size="md" />}
          name="Zoho CRM"
          status={loading ? undefined : rowStatus(Boolean(zoho))}
          highlight={needsZoho}
          meta={
            loading ? (
              <LoadingMeta />
            ) : zoho ? (
              (zoho.emailAddress ?? "Zoho account")
            ) : (
              "Leads, contacts and deals"
            )
          }
          action={
            zoho ? (
              <QuietAction onClick={() => void handleZohoDisconnect()} disabled={busy}>
                Disconnect
              </QuietAction>
            ) : (
              <PrimaryAction onClick={() => void handleZohoConnect()} disabled={busy || loading}>
                Connect
              </PrimaryAction>
            )
          }
        />

        {/* Social */}
        <ConnectorRow
          id="connector-orbit"
          icon={
            <span className="connector-glyph">
              <Share2 size={19} />
            </span>
          }
          name="Social"
          status={loading ? undefined : rowStatus(Boolean(orbit))}
          statusLabel={orbit ? "On" : undefined}
          highlight={needsOrbit}
          expandable={Boolean(orbit)}
          expanded={openRow === "orbit"}
          onToggle={() => toggleRow("orbit")}
          meta={
            loading ? (
              <LoadingMeta />
            ) : orbit ? (
              orbitChannels.length > 0 ? (
                `${orbitChannels.length} channel${orbitChannels.length === 1 ? "" : "s"} connected`
              ) : (
                "No channels yet"
              )
            ) : orbitPlatformConfigured === false ? (
              "Not available on this workspace yet"
            ) : (
              "Post to Instagram, X, LinkedIn and more"
            )
          }
          action={
            orbit ? (
              <QuietAction onClick={() => void handleOrbitDisconnect()} disabled={busy}>
                Turn off
              </QuietAction>
            ) : (
              <PrimaryAction
                onClick={() => void handleOrbitEnable()}
                disabled={orbitConnecting || busy || loading || orbitPlatformConfigured === false}
              >
                {orbitConnecting ? "Turning on…" : "Turn on"}
              </PrimaryAction>
            )
          }
        >
          <div className="space-y-4">
            <div>
              <span className={sketchLabel}>Add a channel</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ORBIT_CONNECT_BUTTONS.map((id) => {
                  const entry = getCatalogEntry(id);
                  if (!entry) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={busy || orbitSocialBusy !== null}
                      onClick={() => void handleOrbitSocialConnect(id)}
                      className="connector-channel-add"
                    >
                      <ConnectorLogo name={entry.name} logo={entry.logo} size="sm" />
                      <span>{orbitSocialBusy === id ? "Opening…" : entry.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {orbitChannelsLoading && orbitChannels.length === 0 ? (
              <p className="connector-meta flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Loading channels…
              </p>
            ) : orbitChannels.length > 0 ? (
              <ul className="connector-sublist">
                {orbitChannels.map((ch) => (
                  <li key={ch.id}>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-black">{ch.name}</p>
                      <p className="connector-meta truncate">
                        {ch.profile ? `@${ch.profile}` : ch.identifier}
                        {ch.disabled ? " · paused" : ""}
                      </p>
                    </div>
                    <QuietAction
                      disabled={busy}
                      onClick={() => void handleOrbitChannelDisconnect(ch.id)}
                    >
                      Remove
                    </QuietAction>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </ConnectorRow>
      </ConnectorPanel>

      {grants.length > 0 ? (
        <section className="mt-8">
          <SectionHeading title="Standing approvals" hint="Active until you revoke them." />
          <ConnectorPanel>
            <ul className="connector-sublist connector-sublist--panel">
              {grants.map((g) => (
                <li key={g.id}>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-black">
                      {jitScopeLabel(g.scope)}
                      {g.agentName ? ` · ${g.agentName}` : ""}
                    </p>
                    <p className="connector-meta truncate">
                      {g.expiresAt
                        ? `Expires ${new Date(g.expiresAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}`
                        : "This conversation"}
                    </p>
                  </div>
                  <QuietAction
                    disabled={Boolean(revoking[g.id])}
                    onClick={() => void handleRevokeGrant(g.id)}
                  >
                    {revoking[g.id] ? "Revoking…" : "Revoke"}
                  </QuietAction>
                </li>
              ))}
            </ul>
          </ConnectorPanel>
        </section>
      ) : null}

      <ConnectorCatalogSection />
    </div>
  );
}

/* ── Small shared bits ───────────────────────────────────────────────────── */

function LoadingMeta() {
  return <span className="sketch-skeleton inline-block h-3 w-28 align-middle" />;
}

function PrimaryAction({
  children,
  onClick,
  disabled,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="connector-action connector-action--primary">
      {children}
    </button>
  );
}

function QuietAction({
  children,
  onClick,
  disabled,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="connector-action connector-action--quiet">
      {children}
    </button>
  );
}
