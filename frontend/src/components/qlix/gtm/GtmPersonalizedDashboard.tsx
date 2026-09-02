"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { GtmCrmSection } from "@/components/qlix/gtm/GtmCrmSection";
import { GtmEditableRoadmap } from "@/components/qlix/gtm/GtmEditableRoadmap";
import { GtmSuggestedTeam } from "@/components/qlix/gtm/GtmSuggestedTeam";
import { GtmWorkspaceProgress } from "@/components/qlix/gtm/GtmWorkspaceProgress";
import { SketchPageHeader } from "@/components/qlix/sketch";
import {
  getGtmDiscoveryWorkspace,
  regenerateGtmDiscoveryPlan,
  type GtmDiscoveryWorkspace,
  type GtmIdeaContent,
  type GtmWorkspaceNextAction,
} from "@/lib/gtm-api";

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="border border-black/25 bg-[#fbfaf6] p-5">
      <h2 className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/45">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function AnswersCollapsible({ content }: { readonly content: GtmIdeaContent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-black/10 pt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 font-serif text-[10px] uppercase tracking-widest text-black/55"
      >
        What you told us
        {open ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
      </button>
      {open ? (
        <dl className="mt-3 grid gap-3 text-[12px] sm:grid-cols-2">
          <div><dt className="text-black/40">Idea</dt><dd className="mt-1">{content.idea}</dd></div>
          <div><dt className="text-black/40">Problem</dt><dd className="mt-1">{content.problem || "Unknown"}</dd></div>
          <div><dt className="text-black/40">Audience</dt><dd className="mt-1">{content.audience || "Unknown"}</dd></div>
          <div><dt className="text-black/40">Solution</dt><dd className="mt-1">{content.solution || "Unknown"}</dd></div>
          <div><dt className="text-black/40">Outcome</dt><dd className="mt-1">{content.outcome || "Unknown"}</dd></div>
          <div><dt className="text-black/40">Constraints</dt><dd className="mt-1">{content.constraints || "None"}</dd></div>
        </dl>
      ) : null}
    </div>
  );
}

function DoFirstCard({
  workspace,
  routePrefix,
  roadmapRef,
  crmRef,
}: {
  readonly workspace: GtmDiscoveryWorkspace;
  readonly routePrefix: string;
  readonly roadmapRef: React.RefObject<HTMLDivElement | null>;
  readonly crmRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { readiness } = workspace;
  const buildTeamHref = `${routePrefix}/gtm/build-team`;

  function actionFor(nextAction: GtmWorkspaceNextAction): { href?: string; onClick?: () => void; label: string } | null {
    switch (nextAction) {
      case "build_team":
        return { href: buildTeamHref, label: "Build team" };
      case "choose_crm":
        return { onClick: () => crmRef.current?.scrollIntoView({ behavior: "smooth" }), label: readiness.nextActionLabel };
      case "connect_zoho":
        return { href: `${routePrefix}/connectors#zoho`, label: readiness.nextActionLabel };
      case "review_roadmap":
        return { onClick: () => roadmapRef.current?.scrollIntoView({ behavior: "smooth" }), label: readiness.nextActionLabel };
      default:
        return null;
    }
  }

  const action = actionFor(readiness.nextAction);
  const isComplete = readiness.nextAction === "complete";

  return (
    <div className="border border-black bg-black px-5 py-4 text-white">
      <p className="font-serif text-[10px] uppercase tracking-[0.16em] text-white/60">Do this first</p>
      <p className="mt-2 text-[16px] font-medium">{readiness.nextActionLabel}</p>
      {readiness.nextAction === "build_team" ? (
        <p className="mt-2 text-[13px] text-white/70">
          One click builds your full GTM team with parallel execution.
        </p>
      ) : null}
      {action?.href ? (
        <Link href={action.href} className="mt-4 inline-block bg-white px-4 py-2 font-serif text-[10px] uppercase tracking-widest text-black">
          {action.label}
        </Link>
      ) : action?.onClick ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 inline-block bg-white px-4 py-2 font-serif text-[10px] uppercase tracking-widest text-black"
        >
          {action.label}
        </button>
      ) : isComplete ? (
        <p className="mt-2 text-[13px] text-white/70">Your team is built — keep working through the roadmap below.</p>
      ) : null}
    </div>
  );
}

function WorkspaceDashboard({
  workspace,
  ideaContent,
  routePrefix,
  onUpdated,
}: {
  readonly workspace: GtmDiscoveryWorkspace;
  readonly ideaContent: GtmIdeaContent | null;
  readonly routePrefix: string;
  readonly onUpdated: (workspace: GtmDiscoveryWorkspace) => void;
}) {
  const content = workspace.plan?.content;
  const roadmapRef = useRef<HTMLDivElement>(null);
  const crmRef = useRef<HTMLDivElement>(null);

  if (!content) {
    return <p className="text-center text-[13px] text-black/45">Plan is ready but missing content. Try regenerating.</p>;
  }

  return (
    <div className="space-y-4">
      <GtmWorkspaceProgress readiness={workspace.readiness} />

      <DoFirstCard
        workspace={workspace}
        routePrefix={routePrefix}
        roadmapRef={roadmapRef}
        crmRef={crmRef}
      />

      <p className="text-[13px] text-black/55">
        This plan turns your idea into a working discovery team — not outreach yet.
      </p>

      <div>
        <GtmSuggestedTeam workspace={workspace} routePrefix={routePrefix} />
      </div>

      <div ref={crmRef}>
        <GtmCrmSection workspace={workspace} routePrefix={routePrefix} onUpdated={onUpdated} />
      </div>

      <Section title="Focus">
        <p className="text-[15px] font-medium text-black">{content.focus.audience}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-black/70">
          {content.focus.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
        {content.focus.openQuestions.length > 0 ? (
          <div className="mt-4 border-t border-black/10 pt-4">
            <p className="font-serif text-[10px] uppercase tracking-widest text-black/45">Still unknown</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-black/60">
              {content.focus.openQuestions.map((question) => <li key={question}>{question}</li>)}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title="Assumptions we'll validate">
        <ul className="space-y-3">
          {content.hypotheses.map((hypothesis) => (
            <li key={hypothesis.statement} className="border-l-2 border-black/20 pl-3 text-[13px]">
              <p className="font-serif text-[10px] uppercase tracking-widest text-black/40">{hypothesis.kind}</p>
              <p className="mt-1 text-black/75">{hypothesis.statement}</p>
            </li>
          ))}
        </ul>
      </Section>

      <div ref={roadmapRef}>
        <Section title="Suggested roadmap">
          <GtmEditableRoadmap workspace={workspace} onUpdated={onUpdated} />
        </Section>
      </div>

      <Section title="Summary">
        <p className="text-[14px] leading-relaxed text-black">{content.summary}</p>
        {ideaContent ? <AnswersCollapsible content={ideaContent} /> : null}
      </Section>
    </div>
  );
}

export function GtmPersonalizedDashboard({ routePrefix = "/organization" }: { readonly routePrefix?: string }) {
  const [workspace, setWorkspace] = useState<GtmDiscoveryWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;

    async function refresh() {
      const result = await getGtmDiscoveryWorkspace();
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
        setLoading(false);
        return;
      }
      setWorkspace(result.workspace);
      setError(null);
      setLoading(false);
      if (result.workspace.plan?.status === "generating" && interval === undefined) {
        interval = window.setInterval(() => { void refresh(); }, 2500);
      }
      if (result.workspace.plan?.status !== "generating" && interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  async function onRegenerate() {
    setBusy(true);
    setError(null);
    const result = await regenerateGtmDiscoveryPlan();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const refreshed = await getGtmDiscoveryWorkspace();
    if (refreshed.ok) setWorkspace(refreshed.workspace);
  }

  const plan = workspace?.plan ?? null;
  const ideaContent = workspace?.idea?.content ?? null;
  const subtitle = plan?.content?.summary
    ?? "Turn your six discovery answers into a governed GTM workspace.";

  if (loading) {
    return <p className="py-10 text-center text-[13px] text-black/45">Loading your workspace…</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SketchPageHeader
        title="Your GTM workspace"
        subtitle={subtitle}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link
              href={`${routePrefix}/gtm?edit=answers`}
              className="border border-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest"
            >
              Edit answers
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRegenerate()}
              className="inline-flex items-center gap-2 border border-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest disabled:opacity-40"
            >
              <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
              Regenerate
            </button>
            <Link
              href={`${routePrefix}/ai-brain`}
              className="border border-black/25 px-3 py-2 font-serif text-[10px] uppercase tracking-widest text-black/55"
            >
              Talk to Exa
            </Link>
          </div>
        )}
      />

      <div className="py-4 sm:py-8">
        {error ? <p className="mb-4 border border-black bg-[#f4d7cf] px-3 py-2 text-[12px]" role="alert">{error}</p> : null}

        {!plan ? (
          <div className="mx-auto max-w-2xl border border-black/25 bg-[#fbfaf6] p-8 text-center">
            <p className="text-[14px] text-black/70">No plan yet. Answer the six discovery questions first.</p>
            <Link href={`${routePrefix}/gtm`} className="mt-4 inline-block font-serif text-[10px] uppercase tracking-widest underline underline-offset-4">
              Start discovery questions
            </Link>
          </div>
        ) : plan.status === "generating" ? (
          <div className="mx-auto flex max-w-2xl flex-col items-center border border-black/25 bg-[#fbfaf6] p-10 text-center">
            <Loader2 className="size-6 animate-spin text-black/60" aria-hidden />
            <h2 className="mt-4 text-lg font-medium">Building your plan…</h2>
            <p className="mt-2 max-w-md text-[13px] text-black/55">
              Exa is reading your answers and drafting your team, roadmap, and next steps. This usually takes under a minute.
            </p>
          </div>
        ) : plan.status === "failed" ? (
          <div className="mx-auto max-w-2xl border border-black/25 bg-[#fbfaf6] p-8">
            <h2 className="text-lg font-medium">We could not finish your plan</h2>
            <p className="mt-2 text-[13px] text-black/60">{plan.errorMessage ?? "Try again in a moment."}</p>
            {ideaContent ? <AnswersCollapsible content={ideaContent} /> : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRegenerate()}
              className="mt-5 border border-black bg-black px-4 py-2 font-serif text-[10px] uppercase tracking-widest text-white disabled:opacity-40"
            >
              Try again
            </button>
          </div>
        ) : workspace && plan.content ? (
          <WorkspaceDashboard
            workspace={workspace}
            ideaContent={ideaContent}
            routePrefix={routePrefix}
            onUpdated={setWorkspace}
          />
        ) : (
          <p className="text-center text-[13px] text-black/45">Plan is ready but missing content. Try regenerating.</p>
        )}
      </div>
    </div>
  );
}
