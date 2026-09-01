"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Copy, Download, Laptop, RefreshCw } from "lucide-react";
import {
  extensionDownloadUrl,
  generateDeviceCode,
  getSession,
  listEvidence,
  type DeviceCodeDTO,
  type DeviceGrantDTO,
  type EvidenceRecordDTO,
  type WorkSessionDTO,
} from "@/lib/assessment-api";
import { EvidenceTimeline } from "./EvidenceTimeline";
import { formatSessionDate, statusLabel, statusTone } from "./assessmentUi";
import { cn } from "@/lib/utils/cn";
import {
  SketchBox,
  SketchPageHeader,
  sketchButtonGhost,
  sketchButtonPrimary,
  sketchButtonSecondary,
  sketchLabel,
} from "@/components/qlix/sketch";

function msRemaining(expiresAt: string): number {
  return new Date(expiresAt).getTime() - Date.now();
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const TIMELINE_POLL_MS = 10_000;

function hasBrief(session: WorkSessionDTO): boolean {
  return Boolean(
    session.projectDescription ||
      session.expectedStack.length > 0 ||
      session.windowStartsAt ||
      session.aiUsagePolicy ||
      session.checklist.length > 0 ||
      session.requiredDeliverables.length > 0,
  );
}

export function AssessmentSessionDetailView({
  sessionId,
  routePrefix,
}: {
  readonly sessionId: string;
  readonly routePrefix: "/individual" | "/organization";
}) {
  const listHref = `${routePrefix}/assessments`;

  const [tab, setTab] = useState<"overview" | "timeline">("overview");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<WorkSessionDTO | null>(null);
  const [deviceGrants, setDeviceGrants] = useState<DeviceGrantDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<DeviceCodeDTO | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceRecordDTO[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [, forceTick] = useState(0);

  async function loadSession() {
    const result = await getSession(sessionId);
    if (!result) {
      setError("Could not load this assessment.");
      return;
    }
    setSession(result.session);
    setDeviceGrants(result.deviceGrants);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadSession().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function loadEvidence() {
    setEvidenceLoading(true);
    const rows = await listEvidence(sessionId);
    if (rows) setEvidence(rows);
    setEvidenceLoading(false);
  }

  useEffect(() => {
    if (tab !== "timeline") return;
    void loadEvidence();
    const interval = setInterval(() => void loadEvidence(), TIMELINE_POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sessionId]);

  useEffect(() => {
    if (!code) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [code]);

  async function onGenerateCode() {
    setGenerating(true);
    setError(null);
    setCopied(false);
    const result = await generateDeviceCode(sessionId);
    setGenerating(false);
    if (!result) {
      setError("Could not generate a connect code.");
      return;
    }
    setCode(result);
  }

  function onCopy() {
    if (!code) return;
    void navigator.clipboard.writeText(code.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SketchPageHeader title="Assessment" subtitle="Loading session…" />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SketchPageHeader title="Assessment" subtitle={error} />
      </div>
    );
  }

  const expired = code ? msRemaining(code.expiresAt) <= 0 : false;
  const remainingLabel = code && !expired ? `${Math.ceil(msRemaining(code.expiresAt) / 60_000)}m` : null;
  const activeDevice = deviceGrants.find((g) => !g.revokedAt) ?? deviceGrants[0] ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-7">
      <div>
        <Link
          href={listHref}
          className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-black/40 transition hover:text-black"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All assessments
        </Link>
        <SketchPageHeader
          title={session?.subjectRef ?? "Assessment"}
          subtitle={session ? `Opened ${formatSessionDate(session.startedAt)}` : undefined}
          actions={
            session ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em]",
                  statusTone(session.status) === "green" && "bg-[color:var(--sketch-green-soft)] text-black/75",
                  statusTone(session.status) === "blue" && "bg-[color:var(--sketch-tint-blue)] text-black/75",
                  statusTone(session.status) === "default" && "bg-black/[0.04] text-black/55",
                  statusTone(session.status) === "amber" && "bg-[color:var(--sketch-tint-amber)] text-black/75",
                )}
              >
                {statusLabel(session.status)}
              </span>
            ) : null
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SketchBox className="px-5 py-4" tone="white">
          <p className={cn(sketchLabel, "text-black/40")}>Device</p>
          {activeDevice ? (
            <p className="mt-2 flex items-center gap-2 text-[14px] text-black">
              <Laptop className="size-3.5 text-black/35" aria-hidden />
              <span className="truncate">
                {activeDevice.deviceLabel}
                <span className="text-black/40"> · {relativeTime(activeDevice.lastSeenAt)}</span>
              </span>
            </p>
          ) : (
            <p className="mt-2 text-[14px] text-black/40">Waiting to connect</p>
          )}
        </SketchBox>
        <SketchBox className="px-5 py-4" tone="white">
          <p className={cn(sketchLabel, "text-black/40")}>Evidence</p>
          <p className="mt-2 text-[14px] text-black">
            {tab === "timeline" || evidence.length > 0
              ? `${evidence.length} event${evidence.length === 1 ? "" : "s"}`
              : "Open Timeline to watch live"}
          </p>
        </SketchBox>
      </div>

      <div className="flex gap-1 rounded-full border border-black/10 bg-[#E2F0CC]/50 p-1 w-fit">
        {(["overview", "timeline"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] transition",
              tab === t ? "bg-black text-white" : "text-black/45 hover:text-black",
            )}
          >
            {t === "overview" ? "Overview" : `Timeline${evidence.length ? ` · ${evidence.length}` : ""}`}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="flex flex-col gap-5">
          {session && hasBrief(session) && (
            <SketchBox className="flex flex-col gap-6 p-6 sm:p-8" tone="white">
              <p className={cn(sketchLabel, "text-black/40")}>Brief</p>
              {session.projectDescription && (
                <p className="max-w-2xl whitespace-pre-wrap text-[15px] leading-relaxed text-black/80">
                  {session.projectDescription}
                </p>
              )}
              {session.expectedStack.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {session.expectedStack.map((tech) => (
                    <span
                      key={tech}
                      className="rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-[11px] tracking-wide text-black/65"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              )}
              {(session.windowStartsAt || session.windowEndsAt) && (
                <p className="text-[13px] text-black/50">
                  {formatSessionDate(session.windowStartsAt)} → {formatSessionDate(session.windowEndsAt)}
                </p>
              )}
              {session.aiUsagePolicy && (
                <div>
                  <p className={cn(sketchLabel, "mb-2 text-black/40")}>AI policy</p>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-black/65">
                    {session.aiUsagePolicy}
                  </p>
                </div>
              )}
              {session.checklist.length > 0 && (
                <div>
                  <p className={cn(sketchLabel, "mb-3 text-black/40")}>Checklist</p>
                  <ul className="flex flex-col gap-2">
                    {session.checklist.map((item) => (
                      <li key={item.id} className="flex items-start gap-2.5 text-[13px] text-black/70">
                        <span className="mt-1.5 size-1 rounded-full bg-black/25" aria-hidden />
                        {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {session.requiredDeliverables.length > 0 && (
                <div>
                  <p className={cn(sketchLabel, "mb-3 text-black/40")}>Deliverables</p>
                  <ul className="flex flex-col gap-2">
                    {session.requiredDeliverables.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[13px] text-black/70">
                        <span className="mt-1.5 size-1 rounded-full bg-black/25" aria-hidden />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </SketchBox>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <SketchBox className="flex flex-col gap-4 p-6" tone="white">
              <p className={cn(sketchLabel, "text-black/35")}>01</p>
              <h2 className="text-[16px] font-medium tracking-tight text-black">Install the extension</h2>
              <p className="text-[13px] leading-relaxed text-black/55">
                Once in VS Code: Extensions → ⋯ → Install from VSIX.
              </p>
              <a href={extensionDownloadUrl()} className={cn(sketchButtonSecondary, "mt-auto w-fit")}>
                <Download className="size-3.5" aria-hidden />
                Download VSIX
              </a>
            </SketchBox>

            <SketchBox className="flex flex-col gap-4 p-6" tone="white">
              <p className={cn(sketchLabel, "text-black/35")}>02</p>
              <h2 className="text-[16px] font-medium tracking-tight text-black">Connect</h2>
              <p className="text-[13px] leading-relaxed text-black/55">
                Install the extension, open the project folder, and paste this code when Qlix asks. One use, 15
                minutes.
              </p>

              {code && !expired ? (
                <div className="mt-1 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-2xl bg-black px-5 py-3 font-mono text-[22px] tracking-[0.28em] text-white">
                      {code.code}
                    </span>
                    <button type="button" onClick={onCopy} className={sketchButtonGhost}>
                      <Copy className="size-3.5" aria-hidden />
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className={cn(sketchLabel, "text-black/35")}>Expires in {remainingLabel}</p>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => void onGenerateCode()}
                  className={cn(sketchButtonPrimary, "mt-auto w-fit")}
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                  {generating ? "Generating…" : expired ? "New code" : "Generate code"}
                </button>
              )}

              {error && <p className="text-[13px] text-black/70">{error}</p>}
            </SketchBox>
          </div>

          {deviceGrants.length > 0 && (
            <SketchBox className="flex flex-col gap-1 p-2" tone="white">
              <p className={cn(sketchLabel, "px-4 pb-2 pt-3 text-black/40")}>Devices</p>
              {deviceGrants.map((grant) => (
                <div
                  key={grant.id}
                  className="flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-[13px]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-black">{grant.deviceLabel}</p>
                    <p className="truncate text-[12px] text-black/40">{grant.workspaceRoot}</p>
                  </div>
                  <span className="shrink-0 text-[11px] uppercase tracking-[0.12em] text-black/40">
                    {grant.revokedAt ? "Disconnected" : relativeTime(grant.lastSeenAt)}
                  </span>
                </div>
              ))}
            </SketchBox>
          )}
        </div>
      ) : (
        <SketchBox className="flex flex-col p-5 sm:p-6" tone="white">
          <div className="mb-4 flex items-center justify-between">
            <span className={cn(sketchLabel, evidenceLoading ? "text-black/30" : "text-[color:var(--sketch-green)]")}>
              {evidenceLoading ? "Refreshing" : "Live"}
            </span>
            <button type="button" onClick={() => void loadEvidence()} className={sketchButtonGhost}>
              <RefreshCw className="size-3.5" aria-hidden />
              Refresh
            </button>
          </div>
          <EvidenceTimeline evidence={evidence} />
        </SketchBox>
      )}
    </div>
  );
}
