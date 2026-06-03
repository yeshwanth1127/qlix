"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Copy, Download, Fingerprint, Loader2, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import {
  type AgentDTO,
  type VerifiableCredentialDTO,
  deleteAgent,
  getAgent,
  getRuntimeStatus,
  restartCloudRunner,
  clearCloudRunnerProvisioning,
  reissueHybridStarterPack,
  updateAgentDescription,
} from "@/lib/agents-api";
import { downloadBase64File } from "@/lib/download";
import { canDeleteAgent } from "@/lib/org-permissions";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import { useSession } from "@/components/qlix/session-context";
import { cn } from "@/lib/utils/cn";

interface AgentDetailViewProps {
  readonly agentId: string;
  readonly routePrefix: "/individual" | "/organization";
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Cannot combine `dateStyle`/`timeStyle` with `timeZoneName` (throws Invalid option in browsers).
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

/** Product convention: first 8 + … + last 6 for long DIDs. */
function shortDid(did: string): string {
  if (did.length <= 18) return did;
  return `${did.slice(0, 8)}…${did.slice(-6)}`;
}

function shortHexKey(hex: string): string {
  const t = hex.trim();
  if (t.length <= 22) return t;
  return `${t.slice(0, 12)}…${t.slice(-8)}`;
}

export function AgentDetailView({ agentId, routePrefix }: AgentDetailViewProps) {
  const router = useRouter();
  const { session } = useSession();
  const [data, setData] = useState<{ agent: AgentDTO; credentials: VerifiableCredentialDTO[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [runtimeStatus, setRuntimeStatus] = useState<{
    heartbeatFresh: boolean;
    provisioningStatus: string | null;
    lastHeartbeatAt: string | null;
    provisioningError?: string | null;
    inferenceError?: string | null;
  } | null>(null);
  const [restartSubmitting, setRestartSubmitting] = useState(false);
  const [runnerRestarting, setRunnerRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [reissuing, setReissuing] = useState(false);
  const [reissueError, setReissueError] = useState<string | null>(null);
  const [reissueDone, setReissueDone] = useState(false);
  const [deleteExpanded, setDeleteExpanded] = useState(false);
  const [deleteNameInput, setDeleteNameInput] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [descSaving, setDescSaving] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getAgent(agentId).then((result) => {
      if (cancelled) return;
      if (!result) {
        setError("Agent not found");
      } else {
        setData(result);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    const agent = data?.agent;
    if (!agent || (agent.runtime !== "cloud" && agent.runtime !== "hybrid")) return;
    let cancelled = false;
    const tick = async () => {
      let s: Awaited<ReturnType<typeof getRuntimeStatus>>;
      try {
        s = await getRuntimeStatus(agent.id);
      } catch {
        return;
      }
      if (cancelled) return;
      if (!s) return;
      setRuntimeStatus({
        heartbeatFresh: s.heartbeatFresh,
        provisioningStatus: s.provisioningStatus,
        lastHeartbeatAt: s.lastHeartbeatAt,
        provisioningError: s.provisioningError ?? null,
        inferenceError: s.inferenceError ?? null,
      });
      if (s.heartbeatFresh || s.provisioningStatus === "failed") {
        setRunnerRestarting(false);
      }
      if (s.heartbeatFresh) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                agent: {
                  ...prev.agent,
                  cloudProvisioningStatus:
                    s.provisioningStatus === "provisioning" ? "running" : s.provisioningStatus,
                  cloudLastHeartbeatAt: s.lastHeartbeatAt ?? prev.agent.cloudLastHeartbeatAt,
                  cloudProvisioningError: null,
                },
              }
            : prev,
        );
      }
    };
    void tick();
    const fastPoll =
      runnerRestarting ||
      restartSubmitting ||
      data?.agent.cloudProvisioningStatus === "provisioning";
    const t = window.setInterval(() => void tick(), fastPoll ? 1000 : 2500);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [
    data?.agent.id,
    data?.agent.runtime,
    data?.agent.cloudProvisioningStatus,
    runnerRestarting,
    restartSubmitting,
  ]);

  if (loading) {
    return (
      <div className="animate-qlix-fade-in space-y-6">
        <div className="h-4 w-24 animate-pulse rounded bg-[var(--glass-muted-bg)]" />
        <ReflectiveCard className="rounded-xl" contentClassName="p-5">
          <div className="space-y-4">
            <div className="h-6 w-2/3 max-w-xs animate-pulse rounded bg-[var(--glass-muted-bg)]" />
            <div className="h-4 w-full max-w-md animate-pulse rounded bg-[var(--glass-muted-bg)]" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-16 animate-pulse rounded-lg bg-[var(--glass-muted-bg)]" />
              <div className="h-16 animate-pulse rounded-lg bg-[var(--glass-muted-bg)]" />
              <div className="h-16 animate-pulse rounded-lg bg-[var(--glass-muted-bg)]" />
              <div className="h-16 animate-pulse rounded-lg bg-[var(--glass-muted-bg)]" />
            </div>
          </div>
        </ReflectiveCard>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <Link
          href={`${routePrefix}/agents`}
          className="inline-flex items-center gap-1 text-[12px] text-[--text-tertiary] hover:text-[--text-primary]"
        >
          <ChevronLeft className="size-3.5" aria-hidden /> Back
        </Link>
        <p className="text-[12px] text-[--danger]">{error ?? "Failed to load agent."}</p>
      </div>
    );
  }

  const { agent, credentials } = data;

  const derivedRunnerStatus = () => {
    if (agent.runtime !== "cloud") return agent.status;
    if (runtimeStatus?.heartbeatFresh) return "online";
    if (restartSubmitting || runnerRestarting) return "restarting";
    if (runtimeStatus?.provisioningStatus === "failed" || agent.cloudProvisioningStatus === "failed") return "runner_failed";
    if (runtimeStatus?.provisioningStatus) return runtimeStatus.provisioningStatus;
    if (agent.cloudProvisioningStatus === "provisioning") return "provisioning";
    return "offline";
  };

  const runnerOnline = runtimeStatus?.heartbeatFresh === true;

  const runnerBusy =
    restartSubmitting ||
    runnerRestarting ||
    runtimeStatus?.provisioningStatus === "provisioning" ||
    agent.cloudProvisioningStatus === "provisioning";

  const canManageRunner =
    (agent.runtime === "cloud" || agent.runtime === "hybrid") &&
    session != null &&
    (agent.userId === session.user.id || (agent.orgId != null && agent.orgId === session.organization.id));

  const isOrgConsole = routePrefix === "/organization";
  const canDelete =
    session != null &&
    (isOrgConsole
      ? agent.orgId != null &&
        agent.orgId === session.organization.id &&
        canDeleteAgent(session.user.role)
      : agent.orgId == null && agent.userId === session.user.id);

  const nameMatchesDelete = deleteNameInput.trim() === agent.name.trim();

  const handleDelete = async () => {
    if (!nameMatchesDelete || deleteSubmitting) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    const res = await deleteAgent(agent.id, deleteNameInput.trim());
    setDeleteSubmitting(false);
    if (!res.ok) {
      setDeleteError(res.errorMessage);
      return;
    }
    router.push(`${routePrefix}/agents`);
    router.refresh();
  };

  return (
    <div className="animate-qlix-fade-in space-y-6">
      <Link
        href={`${routePrefix}/agents`}
        className="inline-flex items-center gap-1 text-[12px] text-[--text-tertiary] hover:text-[--text-primary]"
      >
        <ChevronLeft className="size-3.5" aria-hidden /> All agents
      </Link>

      <ReflectiveCard className="rounded-xl" contentClassName="p-5 sm:p-6">
        <div className="flex flex-col gap-1 border-b border-[--border-subtle] pb-4">
          <div className="flex items-start gap-2">
            <Fingerprint className="mt-0.5 size-5 shrink-0 text-[--accent]" aria-hidden />
            <div className="min-w-0 flex-1">
              <h1 className="text-[17px] font-medium tracking-[-0.02em] text-[--text-primary]">{agent.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] text-[--text-secondary]" title={agent.did}>
                  {shortDid(agent.did)}
                </span>
                <CopyInline value={agent.did} label="DID" />
              </div>
            </div>
            <StatusPill status={derivedRunnerStatus()} />
          </div>

          {/* Description */}
          <div className="mt-3">
            {descEditing ? (
              <div className="space-y-2">
                <textarea
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={8}
                  placeholder="Describe what this agent does — this becomes its system prompt."
                  className="w-full resize-none rounded-md border border-[--border-default] bg-[--bg-base] px-3 py-2 text-[13px] text-[--text-primary] outline-none focus:border-[--accent] focus:ring-2 focus:ring-[--accent]/20 placeholder:text-[--text-tertiary]"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={descSaving}
                    onClick={async () => {
                      setDescSaving(true);
                      setDescError(null);
                      const res = await updateAgentDescription(agent.id, descDraft.trim() || null);
                      setDescSaving(false);
                      if (!res.ok) { setDescError(res.error); return; }
                      setData((prev) => prev ? { ...prev, agent: res.agent } : prev);
                      setDescEditing(false);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[--accent] px-3 py-1.5 text-[12px] font-medium text-[--accent-contrast] hover:opacity-90 disabled:opacity-50"
                  >
                    {descSaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={descSaving}
                    onClick={() => { setDescEditing(false); setDescError(null); }}
                    className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] text-[--text-tertiary] hover:text-[--text-primary]"
                  >
                    <X className="size-3.5" aria-hidden />
                    Cancel
                  </button>
                  <span className="ml-auto text-[11px] text-[--text-tertiary]">{descDraft.length}/500</span>
                </div>
                {descError && <p className="text-[12px] text-[--danger]">{descError}</p>}
              </div>
            ) : (
              <div className="group flex items-start gap-2">
                <p className={cn("flex-1 text-[13px] leading-relaxed", agent.description ? "text-[--text-secondary]" : "italic text-[--text-tertiary]")}>
                  {agent.description ?? "No description — click to add one."}
                </p>
                <button
                  type="button"
                  onClick={() => { setDescDraft(agent.description ?? ""); setDescEditing(true); setDescError(null); }}
                  className="shrink-0 rounded p-1 text-[--text-tertiary] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[--text-primary] hover:bg-[--bg-hover]"
                  title="Edit description"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
              </div>
            )}
          </div>
        </div>

        {agent.runtime === "cloud" || agent.runtime === "hybrid" ? (
          <section className="mt-4 rounded-lg border border-[--border-subtle] bg-black/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[12px] font-medium text-[--text-primary]">
                  {agent.runtime === "hybrid" ? "Local daemon" : "Cloud runner"}
                </p>
                <p className="mt-0.5 text-[11px] text-[--text-tertiary]">
                  {agent.runtime === "hybrid"
                    ? runtimeStatus?.heartbeatFresh
                      ? "Daemon is online on your computer"
                      : "Offline — unzip the starter pack and double-click Start Qlix Agent"
                    : runnerBusy
                      ? "Restarting runner — building Docker image (often 3–10 minutes)."
                      : runtimeStatus?.heartbeatFresh
                        ? "Runner is online"
                        : runtimeStatus?.provisioningStatus === "failed" ||
                            agent.cloudProvisioningStatus === "failed"
                          ? "Runner is not running (provisioning failed)."
                          : "Runner is offline or still provisioning."}
                  {runtimeStatus?.lastHeartbeatAt
                    ? ` Last heartbeat: ${formatDateTime(runtimeStatus.lastHeartbeatAt)}`
                    : ""}
                </p>
                {runnerBusy ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-200">
                    <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                    Provisioning in progress — status updates every few seconds.
                  </p>
                ) : null}
                {runtimeStatus?.provisioningError ? (
                  <p className="mt-2 whitespace-pre-wrap text-[11px] text-[--danger]">
                    {runtimeStatus.provisioningError}
                  </p>
                ) : null}
                {runtimeStatus?.inferenceError ? (
                  <p className="mt-1 whitespace-pre-wrap text-[11px] text-[--danger]">
                    {runtimeStatus.inferenceError}
                  </p>
                ) : null}
              </div>

              {canManageRunner && agent.runtime === "hybrid" ? (
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    disabled={reissuing}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "Re-issue the starter pack? A fresh ZIP will download and the previously-downloaded starter pack will stop working. The agent's DID, scopes, runs and audit history are preserved.",
                        )
                      ) {
                        return;
                      }
                      setReissuing(true);
                      setReissueError(null);
                      setReissueDone(false);
                      try {
                        const result = await reissueHybridStarterPack(agent.id);
                        if (!result.ok) {
                          setReissueError(result.message);
                          return;
                        }
                        downloadBase64File(
                          result.hybridStarterPack.base64,
                          result.hybridStarterPack.filename,
                          "application/zip",
                        );
                        setReissueDone(true);
                      } catch (err) {
                        setReissueError(
                          err instanceof Error ? err.message : "Failed to re-issue starter pack.",
                        );
                      } finally {
                        setReissuing(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[--accent] px-3 py-1.5 text-[12px] font-medium text-[--accent-contrast] transition-colors hover:bg-[--accent-hover] disabled:opacity-50"
                  >
                    {reissuing ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : reissueDone ? (
                      <Download className="size-3.5" aria-hidden />
                    ) : (
                      <RefreshCw className="size-3.5" aria-hidden />
                    )}
                    {reissuing
                      ? "Re-issuing…"
                      : reissueDone
                        ? "Downloaded — re-issue again"
                        : "Re-issue starter pack"}
                  </button>
                  <p className="max-w-[260px] text-right text-[10px] leading-snug text-[--text-tertiary]">
                    Lost the ZIP? This rotates the signing key and runner token and downloads a fresh
                    starter pack. The old pack stops working.
                  </p>
                  {reissueError ? <p className="text-[11px] text-[--danger]">{reissueError}</p> : null}
                </div>
              ) : null}

              {canManageRunner && agent.runtime === "cloud" ? (
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    disabled={runnerBusy}
                    onClick={async () => {
                      if (
                        runnerOnline &&
                        !window.confirm(
                          "Restart the cloud runner? The agent will be briefly unavailable while the container rebuilds (often 3–10 minutes).",
                        )
                      ) {
                        return;
                      }
                      setRestartSubmitting(true);
                      setRunnerRestarting(true);
                      setRestartError(null);
                      setData((prev) =>
                        prev
                          ? {
                              ...prev,
                              agent: {
                                ...prev.agent,
                                cloudProvisioningStatus: "provisioning",
                                cloudProvisioningError: null,
                              },
                            }
                          : prev,
                      );
                      try {
                        const result = await restartCloudRunner(agent.id);
                        if (!result.ok) {
                          setRestartError(result.message);
                          setRunnerRestarting(false);
                          return;
                        }
                        setRuntimeStatus({
                          heartbeatFresh: false,
                          provisioningStatus: "provisioning",
                          lastHeartbeatAt: null,
                          provisioningError: null,
                          inferenceError: runtimeStatus?.inferenceError ?? null,
                        });
                        const s = await getRuntimeStatus(agent.id);
                        if (s) {
                          setRuntimeStatus({
                            heartbeatFresh: s.heartbeatFresh,
                            provisioningStatus: s.provisioningStatus,
                            lastHeartbeatAt: s.lastHeartbeatAt,
                            provisioningError: s.provisioningError ?? null,
                            inferenceError: s.inferenceError ?? null,
                          });
                          if (s.provisioningStatus === "failed") {
                            setRunnerRestarting(false);
                          }
                        }
                      } catch (err) {
                        setRestartError(
                          err instanceof Error ? err.message : "Restart failed unexpectedly.",
                        );
                        setRunnerRestarting(false);
                      } finally {
                        setRestartSubmitting(false);
                      }
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50",
                      runnerOnline && !runnerBusy
                        ? "border border-[--border-subtle] bg-[var(--glass-muted-bg)] text-[--text-primary] hover:border-[--accent]/40 hover:bg-[--accent]/10"
                        : "bg-[--accent] text-[--accent-contrast] hover:bg-[--accent-hover]",
                    )}
                  >
                    {runnerBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                    {runnerBusy ? "Rebuilding…" : "Rebuild container"}
                  </button>
                  {agent.cloudProvisioningStatus && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm("Clear the stuck provisioning status? You can then try restarting again.")) {
                          return;
                        }
                        try {
                          const result = await clearCloudRunnerProvisioning(agent.id);
                          if (result.ok) {
                            setData((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    agent: {
                                      ...prev.agent,
                                      cloudProvisioningStatus: null,
                                      cloudProvisioningError: null,
                                    },
                                  }
                                : prev,
                            );
                          } else {
                            setRestartError(result.message);
                          }
                        } catch (err) {
                          setRestartError(err instanceof Error ? err.message : "Failed to clear status");
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                    >
                      Clear status
                    </button>
                  )}
                  {restartError ? <p className="text-[11px] text-[--danger]">{restartError}</p> : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="mt-5">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">Lifecycle</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DetailTile label="Created" value={formatDateTime(agent.createdAt)} />
            <DetailTile label="Last active" value={formatDateTime(agent.lastActive)} />
            <DetailTile label="Last connected" value={formatDateTime(agent.lastConnectedAt)} />
            <DetailTile
              label="Keypair delivered"
              value={agent.keypairDeliveredAt ? formatDateTime(agent.keypairDeliveredAt) : "Not recorded"}
            />
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">Runtime</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DetailTile label="Runtime" value={agent.runtime} capitalize />
            <DetailTile label="Model" value={agent.model} mono />
            {agent.runtime === "local" && agent.localInferenceMode ? (
              <DetailTile
                label="Local inference"
                value={
                  agent.localInferenceMode === "local_llm"
                    ? "Local models (on-device)"
                    : "Cloud AI APIs"
                }
                className="sm:col-span-2"
              />
            ) : null}
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">Public key</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[--border-subtle] bg-black/20 px-3 py-2">
            <span className="min-w-0 flex-1 font-mono text-[11px] text-[--text-secondary]" title={agent.publicKey}>
              {shortHexKey(agent.publicKey)}
            </span>
            <CopyInline value={agent.publicKey} label="public key" />
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">Permission scopes</h2>
          <p className="mt-1 text-[11px] text-[--text-tertiary]">
            Always-on grants run without JIT prompts; JIT scopes require approval each time.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ScopeBlock title="Always-on" scopes={agent.alwaysScopes} variant="always" />
            <ScopeBlock title="Just-in-time" scopes={agent.jitScopes} variant="jit" />
          </div>
          {agent.permissionScopes.length > 0 ? (
            <div className="mt-4">
              <p className="text-[11px] font-medium text-[--text-tertiary]">All configured scopes</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {agent.permissionScopes.map((s) => (
                  <li
                    key={s}
                    className="rounded-md border border-[--border-subtle] bg-[var(--glass-muted-bg)] px-2 py-0.5 font-mono text-[11px] text-[--text-primary]"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </ReflectiveCard>

      <ReflectiveCard className="rounded-xl" contentClassName="p-5">
        <h2 className="text-[12px] font-medium text-[--text-secondary]">Verifiable credentials</h2>
        {credentials.length === 0 ? (
          <p className="mt-2 text-[12px] text-[--text-tertiary]">No credentials issued.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {credentials.map((vc) => (
              <li key={vc.id} className="rounded-md border border-[--border-subtle] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[--text-primary] capitalize">{vc.type} VC</span>
                  <span className="shrink-0 text-[11px] text-[--text-tertiary]">
                    issued {formatDateTime(vc.issuedAt)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-[--text-tertiary]">issuer: {vc.issuerDid}</p>
                <pre className="mt-2 overflow-x-auto rounded bg-black/30 px-2 py-1.5 font-mono text-[11px] text-[--text-secondary]">
                  {JSON.stringify(vc.claims, null, 2)}
                </pre>
                <p
                  className="mt-1 break-all font-mono text-[10px] text-[--text-tertiary]"
                  title={vc.signature}
                >
                  sig: {vc.signature.slice(0, 24)}…
                </p>
              </li>
            ))}
          </ul>
        )}
      </ReflectiveCard>

      {canDelete ? (
        <ReflectiveCard className="rounded-xl border border-[--danger]/35" contentClassName="p-5">
          <h2 className="text-[12px] font-medium text-[--danger]">Danger zone</h2>
          <p className="mt-1 text-[12px] text-[--text-secondary]">
            Permanently delete this agent, its verifiable credentials, and audit rows stored for it in Qlix.
            This cannot be undone.
          </p>
          {!deleteExpanded ? (
            <button
              type="button"
              onClick={() => {
                setDeleteExpanded(true);
                setDeleteNameInput("");
                setDeleteError(null);
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[--danger]/50 bg-[--danger]/10 px-3 py-1.5 text-[12px] font-medium text-[--danger] transition-colors hover:bg-[--danger]/20"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete agent…
            </button>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[12px] text-[--text-secondary]">
                  Type <span className="font-medium text-[--text-primary]">{agent.name}</span> to confirm.
                </span>
                <input
                  type="text"
                  value={deleteNameInput}
                  onChange={(e) => setDeleteNameInput(e.target.value)}
                  autoComplete="off"
                  className="mt-1.5 w-full max-w-md rounded-md border border-[--border-subtle] bg-[--bg-base] px-3 py-1.5 text-[13px] text-[--text-primary] outline-none focus:border-[--danger]"
                  placeholder={agent.name}
                />
              </label>
              {deleteError ? (
                <p className="text-[12px] text-[--danger]">{deleteError}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!nameMatchesDelete || deleteSubmitting}
                  onClick={() => void handleDelete()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[--danger] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleteSubmitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                  Delete permanently
                </button>
                <button
                  type="button"
                  disabled={deleteSubmitting}
                  onClick={() => {
                    setDeleteExpanded(false);
                    setDeleteNameInput("");
                    setDeleteError(null);
                  }}
                  className="rounded-md px-3 py-1.5 text-[12px] font-medium text-[--text-tertiary] hover:text-[--text-primary]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </ReflectiveCard>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { readonly status: string }) {
  const s = status.toLowerCase();
  const active = s === "active" || s === "online";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize",
        active
          ? "bg-emerald-950/50 text-emerald-400"
          : "bg-[var(--glass-muted-bg)] text-[--text-secondary]",
      )}
    >
      {status}
    </span>
  );
}

function DetailTile({
  label,
  value,
  mono,
  capitalize,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly capitalize?: boolean;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[--border-subtle] bg-black/15 px-3 py-2.5",
        className,
      )}
    >
      <p className="text-[11px] text-[--text-tertiary]">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-[13px] text-[--text-primary]",
          mono && "font-mono text-[12px]",
          capitalize && "capitalize",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ScopeBlock({
  title,
  scopes,
  variant,
}: {
  readonly title: string;
  readonly scopes: string[];
  readonly variant: "always" | "jit";
}) {
  const borderAccent =
    variant === "jit"
      ? "border-amber-500/25 bg-amber-500/[0.06]"
      : "border-[--border-subtle] bg-black/15";
  return (
    <div className={cn("rounded-lg border p-3", borderAccent)}>
      <p className="text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">{title}</p>
      {scopes.length === 0 ? (
        <p className="mt-2 text-[12px] text-[--text-tertiary]">None</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {scopes.map((s) => (
            <li
              key={s}
              className="rounded border border-[--border-subtle]/80 bg-[var(--glass-muted-bg)] px-2 py-0.5 font-mono text-[11px] text-[--text-primary]"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CopyInline({ value, label }: { readonly value: string; readonly label: string }) {
  const [ok, setOk] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setOk(true);
      window.setTimeout(() => setOk(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="qlix-glass-muted inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[--text-tertiary] transition-colors hover:bg-[var(--glass-surface-bg-hover)] hover:text-[--text-primary]"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {ok ? <Check className="size-[14px] text-green-500" aria-hidden /> : <Copy className="size-[14px]" aria-hidden />}
    </button>
  );
}
