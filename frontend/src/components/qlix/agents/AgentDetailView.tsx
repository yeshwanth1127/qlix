"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Copy, Download, Fingerprint, Loader2, MessageSquare, Pencil, Trash2, X } from "lucide-react";
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
  updateAgentToolProfile,
} from "@/lib/agents-api";
import { downloadBase64File, getStashedStarterPack, type StarterPack } from "@/lib/download";
import { canDeleteAgentRecord } from "@/lib/org-permissions";
import {
  SketchBox,
  SketchListSkeleton,
  SketchPageHeader,
  SketchRow,
  SketchSkeleton,
  sketchButton,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import { AgentMcpBindings } from "@/components/qlix/mcp/AgentMcpBindings";
import { AgentScopesEditor } from "@/components/qlix/agents/AgentScopesEditor";
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
  // Starter pack captured at creation time (this browser session). Lets the agent
  // page offer the ZIP download without re-issuing / rotating the signing key.
  const [stashedPack, setStashedPack] = useState<StarterPack | null>(null);

  useEffect(() => {
    setStashedPack(getStashedStarterPack(agentId));
  }, [agentId]);

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
      <div className="space-y-6" role="status" aria-label="Loading agent">
        <SketchSkeleton className="h-4 w-28 rounded-full" />
        <SketchBox className="p-5">
          <div className="space-y-4">
            <SketchSkeleton className="h-6 max-w-xs w-2/3 rounded-lg" />
            <SketchSkeleton className="h-4 max-w-md w-full rounded-full" />
            <div className="grid gap-3 sm:grid-cols-2">
              <SketchSkeleton className="h-16 rounded-xl" />
              <SketchSkeleton className="h-16 rounded-xl" />
              <SketchSkeleton className="h-16 rounded-xl" />
              <SketchSkeleton className="h-16 rounded-xl" />
            </div>
          </div>
        </SketchBox>
        <SketchListSkeleton rows={3} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <Link
          href={`${routePrefix}/agents`}
          className="inline-flex items-center gap-1 text-[12px] text-black/50 hover:text-black"
        >
          <ChevronLeft className="size-3.5" aria-hidden /> Back
        </Link>
        <p className="text-[12px] text-black">{error ?? "Failed to load agent."}</p>
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

  const canDelete = session != null && canDeleteAgentRecord(agent, session);

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
    <div className="space-y-6 bg-white">
      <Link
        href={`${routePrefix}/agents`}
        className="inline-flex items-center gap-1 text-[12px] text-black/50 hover:text-black"
      >
        <ChevronLeft className="size-3.5" aria-hidden /> All agents
      </Link>

      <SketchBox className="p-5 sm:p-6">
        <div className="flex flex-col gap-1 border-b border-black pb-4">
          <div className="flex items-start gap-2">
            <Fingerprint className="mt-0.5 size-5 shrink-0 text-black" aria-hidden />
            <div className="min-w-0 flex-1">
              <h1 className="text-[17px] font-medium tracking-[-0.02em] text-black">{agent.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] text-black/70" title={agent.did}>
                  {shortDid(agent.did)}
                </span>
                <CopyInline value={agent.did} label="DID" />
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <StatusLabel status={derivedRunnerStatus()} />
              <Link
                href={`${routePrefix}/agents/${agent.id}/chat`}
                className={sketchButton}
              >
                <MessageSquare className="size-3.5" aria-hidden />
                Start chat
              </Link>
            </div>
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
                  className={`${sketchInput} resize-none`}
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
                    className={sketchButton}
                  >
                    {descSaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={descSaving}
                    onClick={() => { setDescEditing(false); setDescError(null); }}
                    className={sketchButton}
                  >
                    <X className="size-3.5" aria-hidden />
                    Cancel
                  </button>
                  <span className="ml-auto text-[11px] text-black/50">{descDraft.length}/500</span>
                </div>
                {descError && <p className="text-[12px] text-black">{descError}</p>}
              </div>
            ) : (
              <div className="group flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[13px] leading-relaxed", agent.description ? "text-black/70" : "italic text-black/50")}>
                    {agent.description ?? "No description — click to add one."}
                  </p>
                  <p className="mt-1 text-[11px] text-black/45">
                    Description helps Qlix route WhatsApp messages to this agent.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setDescDraft(agent.description ?? ""); setDescEditing(true); setDescError(null); }}
                  className="shrink-0 border border-black p-1 text-black/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-black"
                  title="Edit description"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
              </div>
            )}
          </div>
        </div>

        {agent.runtime === "cloud" || agent.runtime === "hybrid" ? (
          <SketchBox className="mt-4 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[12px] font-medium text-black">
                  {agent.runtime === "hybrid" ? "Local agent" : "Cloud agent"}
                </p>
                <p className="mt-0.5 text-[11px] text-black/50">
                  {agent.runtime === "hybrid"
                    ? runtimeStatus?.heartbeatFresh
                      ? "Online on your computer"
                      : "Offline — unzip the starter pack and double-click Start Qlix Agent"
                    : runnerBusy
                      ? "Getting your agent ready — this can take a few minutes."
                      : runtimeStatus?.heartbeatFresh
                        ? "Online and ready"
                        : runtimeStatus?.provisioningStatus === "failed" ||
                            agent.cloudProvisioningStatus === "failed"
                          ? "Your agent isn't running (setup didn't finish)."
                          : "Offline or still starting up."}
                  {runtimeStatus?.lastHeartbeatAt
                    ? ` Last seen: ${formatDateTime(runtimeStatus.lastHeartbeatAt)}`
                    : ""}
                </p>
                {runnerBusy ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-black/60">
                    <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                    Setting up — this updates automatically every few seconds.
                  </p>
                ) : null}
                {runtimeStatus?.provisioningError ? (
                  <p className="mt-2 whitespace-pre-wrap text-[11px] text-black">
                    {runtimeStatus.provisioningError}
                  </p>
                ) : null}
                {runtimeStatus?.inferenceError ? (
                  <p className="mt-1 whitespace-pre-wrap text-[11px] text-black">
                    {runtimeStatus.inferenceError}
                  </p>
                ) : null}
              </div>

              {canManageRunner && agent.runtime === "hybrid" ? (
                <div className="flex flex-col items-end gap-1">
                  {stashedPack ? (
                    <button
                      type="button"
                      onClick={() =>
                        downloadBase64File(stashedPack.base64, stashedPack.filename, "application/zip")
                      }
                      className={sketchButton}
                    >
                      <Download className="size-3.5" aria-hidden />
                      Download starter pack
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={reissuing}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "Download agent again? A fresh ZIP will download and the previously downloaded pack will stop working. The agent's DID, scopes, runs and audit history are preserved.",
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
                          err instanceof Error ? err.message : "Failed to download agent again.",
                        );
                      } finally {
                        setReissuing(false);
                      }
                    }}
                    className={sketchButton}
                  >
                    {reissuing ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Download className="size-3.5" aria-hidden />
                    )}
                    {reissuing
                      ? "Downloading…"
                      : reissueDone
                        ? "Downloaded — download again"
                        : "Download agent again"}
                  </button>
                  <p className="max-w-[260px] text-right text-[10px] leading-snug text-black/50">
                    Lost the ZIP? This rotates the signing key and runner token and downloads a fresh
                    pack. The old pack stops working.
                  </p>
                  {reissueError ? <p className="text-[11px] text-black">{reissueError}</p> : null}
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
                          "Restart this agent? It'll be briefly unavailable while it starts back up (usually a few minutes).",
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
                    className={sketchButton}
                  >
                    {runnerBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                    {runnerBusy ? "Restarting…" : "Restart agent"}
                  </button>
                  {agent.cloudProvisioningStatus && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm("Clear the stuck status? You can then try restarting again.")) {
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
                      className={sketchButton}
                    >
                      Clear status
                    </button>
                  )}
                  {restartError ? <p className="text-[11px] text-black">{restartError}</p> : null}
                </div>
              ) : null}
            </div>
          </SketchBox>
        ) : null}

        <section className="mt-5">
          <h2 className={sketchLabel}>Lifecycle</h2>
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
          <h2 className={sketchLabel}>Runtime</h2>
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
            <label className="sm:col-span-2">
              <span className={sketchLabel}>Tool profile</span>
              <select
                className={`${sketchInput} mt-1`}
                value={agent.toolProfile ?? "full"}
                onChange={(e) => {
                  const next = e.target.value as "minimal" | "coding" | "full";
                  void updateAgentToolProfile(agent.id, next).then((updated) => {
                    if (updated) {
                      setData((prev) => (prev ? { ...prev, agent: updated } : prev));
                    }
                  });
                }}
              >
                <option value="minimal">Minimal — core tools only</option>
                <option value="coding">Coding — files + code focused</option>
                <option value="full">Full — all granted scopes</option>
              </select>
            </label>
          </div>
        </section>

        <section className="mt-6">
          <h2 className={sketchLabel}>Public key</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 border border-black bg-white px-3 py-2">
            <span className="min-w-0 flex-1 font-mono text-[11px] text-black/70" title={agent.publicKey}>
              {shortHexKey(agent.publicKey)}
            </span>
            <CopyInline value={agent.publicKey} label="public key" />
          </div>
        </section>

        <section className="mt-6">
          <h2 className={sketchLabel}>Permission scopes</h2>
          <p className="mt-1 text-[11px] text-black/50">
            Always-on grants run without JIT prompts; JIT scopes require approval each time.
          </p>
          <AgentScopesEditor
            agent={agent}
            orgId={session?.organization.id ?? null}
            onUpdated={(updated) => setData((prev) => (prev ? { ...prev, agent: updated } : prev))}
          />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ScopeBlock title="Always-on" scopes={agent.alwaysScopes} variant="always" />
            <ScopeBlock title="Just-in-time" scopes={agent.jitScopes} variant="jit" />
          </div>
          {agent.permissionScopes.length > 0 ? (
            <div className="mt-4">
              <p className={`${sketchLabel} mt-4`}>All configured scopes</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {agent.permissionScopes.map((s) => (
                  <li
                    key={s}
                    className="border border-black px-2 py-0.5 font-mono text-[11px] text-black"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </SketchBox>

      <SketchBox className="p-5">
        <h2 className="text-[12px] font-medium text-black">Verifiable credentials</h2>
        {credentials.length === 0 ? (
          <p className="mt-2 text-[12px] text-black/50">No credentials issued.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {credentials.map((vc) => (
              <li key={vc.id} className="border border-black p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium capitalize text-black">{vc.type} VC</span>
                  <span className="shrink-0 text-[11px] text-black/50">
                    issued {formatDateTime(vc.issuedAt)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-black/50">issuer: {vc.issuerDid}</p>
                <pre className="mt-2 overflow-x-auto border border-black bg-white px-2 py-1.5 font-mono text-[11px] text-black/70">
                  {JSON.stringify(vc.claims, null, 2)}
                </pre>
                <p
                  className="mt-1 break-all font-mono text-[10px] text-black/50"
                  title={vc.signature}
                >
                  sig: {vc.signature.slice(0, 24)}…
                </p>
              </li>
            ))}
          </ul>
        )}
      </SketchBox>

      <AgentMcpBindings agentId={agentId} canManage={canDelete} />

      {canDelete ? (
        <SketchBox className="p-5">
          <h2 className={sketchLabel}>Danger zone</h2>
          <p className="mt-1 text-[12px] text-black/70">
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
              className={`${sketchButton} mt-3 gap-1.5`}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete agent…
            </button>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[12px] text-black/70">
                  Type <span className="font-medium text-black">{agent.name}</span> to confirm.
                </span>
                <input
                  type="text"
                  value={deleteNameInput}
                  onChange={(e) => setDeleteNameInput(e.target.value)}
                  autoComplete="off"
                  className={`${sketchInput} mt-1.5 max-w-md`}
                  placeholder={agent.name}
                />
              </label>
              {deleteError ? (
                <p className="text-[12px] text-black">{deleteError}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!nameMatchesDelete || deleteSubmitting}
                  onClick={() => void handleDelete()}
                  className={`${sketchButton} disabled:cursor-not-allowed disabled:opacity-50`}
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
                  className={sketchButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </SketchBox>
      ) : null}
    </div>
  );
}

function StatusLabel({ status }: { readonly status: string }) {
  return (
    <span className="shrink-0 font-serif text-[10px] uppercase tracking-widest text-black/60">
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
    <SketchBox className={cn("px-3 py-2.5", className)}>
      <p className="text-[11px] text-black/50">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-[13px] text-black",
          mono && "font-mono text-[12px]",
          capitalize && "capitalize",
        )}
      >
        {value}
      </p>
    </SketchBox>
  );
}

function ScopeBlock({
  title,
  scopes,
}: {
  readonly title: string;
  readonly scopes: string[];
  readonly variant: "always" | "jit";
}) {
  return (
    <SketchBox className="p-3">
      <p className={sketchLabel}>{title}</p>
      {scopes.length === 0 ? (
        <p className="mt-2 text-[12px] text-black/50">None</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {scopes.map((s) => (
            <li
              key={s}
              className="border border-black px-2 py-0.5 font-mono text-[11px] text-black"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </SketchBox>
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
      className="inline-flex size-7 shrink-0 items-center justify-center border border-black bg-white text-black/50 transition-colors hover:bg-black hover:text-white"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {ok ? <Check className="size-[14px] text-black" aria-hidden /> : <Copy className="size-[14px]" aria-hidden />}
    </button>
  );
}
