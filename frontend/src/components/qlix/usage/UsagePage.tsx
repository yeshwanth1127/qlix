"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { SectionHeading } from "@/components/qlix/section-heading";
import { MetricCard } from "@/components/qlix/metric-card";
import { SketchBox, SketchSection, sketchButton, sketchInput, sketchLabel } from "@/components/qlix/sketch";
import { UsageCurrencyToggle } from "@/components/qlix/usage/UsageCurrencyToggle";
import { getDetailedUsage, type DetailedUsageResponse, type DetailedUsageRun } from "@/lib/usage-api";
import { formatDateTimeInDisplayTz } from "@/lib/display-datetime";
import { formatDetailedUsageCost, type UsageDisplayCurrency } from "@/lib/billing-display-money";
import { cn } from "@/lib/utils/cn";

const integer = new Intl.NumberFormat("en-US");

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatTime(value: string): string {
  return formatDateTimeInDisplayTz(value);
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds == null) return "—";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value >= 0.995 || value === 0 ? 0 : 1)}%`;
}

function formatComponents(components?: Record<string, number> | null): string {
  if (!components) return "";
  return Object.entries(components)
    .filter(([, tokens]) => tokens > 0)
    .map(([name, tokens]) => `${name} ${integer.format(tokens)}`)
    .join(" · ");
}

function RunDetails({ run, currency }: { run: DetailedUsageRun; currency: UsageDisplayCurrency }) {
  const packComponents = formatComponents(run.components);
  return (
    <div className="grid gap-5 bg-black/[0.025] px-4 py-4 lg:grid-cols-[minmax(230px,0.75fr)_minmax(360px,1.25fr)]">
      <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-2 text-[12px]">
        <dt className="text-black/50">Run ID</dt><dd className="break-all font-mono">{run.runId ?? run.usageId}</dd>
        <dt className="text-black/50">Conversation</dt><dd className="break-all font-mono">{run.conversationId ?? "—"}</dd>
        <dt className="text-black/50">Team run</dt><dd className="break-all font-mono">{run.teamRunId ?? "—"}</dd>
        <dt className="text-black/50">Invocation</dt><dd>{run.invocationKind ?? run.runType}</dd>
        <dt className="text-black/50">Channel</dt><dd>{run.sourceChannel ?? "—"}</dd>
        <dt className="text-black/50">Generation</dt><dd className="break-all font-mono">{run.generationId ?? "—"}</dd>
        <dt className="text-black/50">Cached input</dt><dd>{integer.format(run.cachedPromptTokens)}</dd>
        <dt className="text-black/50">Peak request</dt><dd>{run.peakRequestTokens == null ? "—" : integer.format(run.peakRequestTokens)}</dd>
        {packComponents && (
          <><dt className="text-black/50">Context pack</dt><dd>{packComponents}</dd></>
        )}
        {run.unexplainedTokens != null && (
          <>
            <dt className="text-black/50">Explained</dt>
            <dd>{integer.format(run.explainedTokens ?? 0)} · {formatPercent(run.coverage ?? 0)}</dd>
            <dt className="text-black/50">Unexplained</dt>
            <dd>{integer.format(run.unexplainedTokens)}</dd>
          </>
        )}
        {(run.teamRunId || run.stageOrder != null) && (
          <>
            <dt className="text-black/50">Team stage</dt>
            <dd>{run.stageOrder == null ? "—" : `stage ${run.stageOrder}`} · attempt {run.attempt ?? 1} · {run.teamRole ?? "worker"}</dd>
          </>
        )}
        {run.upstreamInferenceCostUsd != null && (
          <><dt className="text-black/50">Upstream cost</dt><dd className="font-mono">{formatDetailedUsageCost(run.upstreamInferenceCostUsd, currency)}</dd></>
        )}
      </dl>
      <div className="min-w-0">
        <p className={cn(sketchLabel, "mb-2")}>Context by round</p>
        {run.rounds.length === 0 ? (
          <p className="text-[12px] text-black/50">Round-level context was not recorded for this run.</p>
        ) : (
          <div className="overflow-x-auto border border-black/15 bg-[#E2F0CC]/60">
            <table className="w-full min-w-[520px] text-left text-[12px]">
              <thead className="border-b border-black/15 text-black/50"><tr><th className="px-3 py-2">Round</th><th className="px-3 py-2">Est. input</th><th className="px-3 py-2">Messages</th><th className="px-3 py-2">Tool schema</th><th className="px-3 py-2">Retained result</th><th className="px-3 py-2">Components</th></tr></thead>
              <tbody>{run.rounds.map((round) => (
                <tr key={round.round} className="border-b border-black/10 last:border-0">
                  <td className="px-3 py-2">{round.round}</td><td className="px-3 py-2 tabular-nums">{integer.format(round.estimatedInputTokens)}</td><td className="px-3 py-2 tabular-nums">{integer.format(round.messageTokens)}</td><td className="px-3 py-2 tabular-nums">{integer.format(round.toolsSchemaTokens)}</td><td className="px-3 py-2 tabular-nums">{integer.format(round.retainedToolChars)} chars</td><td className="px-3 py-2 text-black/60">{formatComponents(round.components) || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function UsagePage({ organizationName }: { organizationName?: string }) {
  const { session, loading: sessionLoading } = useSession();
  const [month, setMonth] = useState(currentMonth);
  const [currency, setCurrency] = useState<UsageDisplayCurrency>("USD");
  const [data, setData] = useState<DetailedUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set());
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const result = await getDetailedUsage(month);
    if (!result) setError("Could not load usage. Try signing in again or retry.");
    setData(result);
    setOpenAgents(new Set(result?.groups.map((group) => group.agentId) ?? []));
    setOpenRuns(new Set());
    setLoading(false);
  }, [month]);

  useEffect(() => {
    if (sessionLoading || !session) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, session, sessionLoading]);

  const totals = useMemo(() => (data?.groups ?? []).reduce((acc, group) => ({
    runs: acc.runs + group.totalRuns, input: acc.input + group.promptTokens,
    cached: acc.cached + group.cachedPromptTokens, output: acc.output + group.completionTokens,
    cost: acc.cost + Number(group.providerCostUsd),
  }), { runs: 0, input: 0, cached: 0, output: 0, cost: 0 }), [data]);

  const toggle = (setter: Dispatch<SetStateAction<Set<string>>>, id: string) => setter((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });

  if (sessionLoading) return <p className={sketchLabel}>Loading usage…</p>;
  if (!session) return <p className={sketchLabel}>Please sign in again</p>;

  return (
    <div className="w-full space-y-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <SectionHeading title="Usage" description={organizationName ? `Detailed inference usage for ${organizationName}.` : "Detailed inference usage grouped by agent and run."} />
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1"><span className={sketchLabel}>Billing month</span><input className={cn(sketchInput, "h-[34px] w-[164px] rounded-none py-1.5")} type="month" value={month} max={currentMonth()} onChange={(event) => setMonth(event.target.value)} /></label>
          <UsageCurrencyToggle value={currency} onChange={setCurrency} />
        </div>
      </header>
      {error ? (
        <SketchBox className="flex items-center justify-between gap-4 p-4"><p className="text-[13px]">{error}</p><button type="button" className={sketchButton} onClick={() => void load()}>Retry</button></SketchBox>
      ) : <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Runs" value={integer.format(totals.runs)} subtext={month} />
          <MetricCard label="Input tokens" value={integer.format(totals.input)} subtext={`${integer.format(totals.cached)} cached`} />
          <MetricCard label="Output tokens" value={integer.format(totals.output)} subtext="Generated tokens" />
          <MetricCard label="Provider cost" value={formatDetailedUsageCost(totals.cost, currency)} subtext="Recorded inference cost" />
        </div>
        {data?.attribution && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Prompt explained"
              value={formatPercent(data.attribution.coverage)}
              subtext={data.attribution.meetsTarget ? `Target ${formatPercent(data.attribution.target)} met` : `Below ${formatPercent(data.attribution.target)} target`}
            />
            <MetricCard label="Explained tokens" value={integer.format(data.attribution.explainedTokens)} subtext={formatComponents(Object.fromEntries(Object.entries(data.attribution.byComponent).filter(([name]) => name !== "unexplained"))) || "No component split"} />
            <MetricCard label="Unexplained tokens" value={integer.format(data.attribution.unexplainedTokens)} subtext="Billed input not attributed to a component" />
            <MetricCard label="Team stage rows" value={integer.format(data.teams?.length ?? 0)} subtext="Tokens grouped by stage and attempt" />
          </div>
        )}
        {data?.quality && (
          <SketchSection title="Success-quality guardrails">
            <p className="mb-3 text-[12px] text-black/60">These rates are the Phase 0 measurement contract: whether runs finish, Results pass their contract, artifacts are well-formed, and users have to retry. Completion, contract, and artifact rates should stay high. Retry rate should stay low.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Completion" value={formatPercent(data.quality.completion.rate)} subtext={`${integer.format(data.quality.completion.passed)} of ${integer.format(data.quality.completion.total)} terminal runs`} />
              <MetricCard label="Contract pass" value={formatPercent(data.quality.contractPass.rate)} subtext={`${integer.format(data.quality.contractPass.passed)} of ${integer.format(data.quality.contractPass.total)} Result handbacks`} />
              <MetricCard label="Artifact validity" value={formatPercent(data.quality.artifactValidity.rate)} subtext={`${integer.format(data.quality.artifactValidity.passed)} of ${integer.format(data.quality.artifactValidity.total)} Team artifacts`} />
              <MetricCard label="User retry" value={formatPercent(data.quality.userRetry.rate)} subtext={`${integer.format(data.quality.userRetry.passed)} retries of ${integer.format(data.quality.userRetry.total)} user-started runs`} />
            </div>
          </SketchSection>
        )}
        {data?.teams && data.teams.length > 0 && (
          <SketchSection title="Team tokens by stage and attempt">
            <p className="mb-3 text-[12px] text-black/60">Each row is one Team worker (or supervisor) attempt. Use this to see which pipeline stage burned tokens and whether a retry added a second attempt.</p>
            <div className="overflow-x-auto border border-black/15">
              <table className="w-full min-w-[720px] text-left text-[12px]">
                <thead className="border-b border-black/15 text-black/50">
                  <tr>
                    <th className="px-3 py-2">Team run</th>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2">Attempt</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2 text-right">Input</th>
                    <th className="px-3 py-2 text-right">Output</th>
                    <th className="px-3 py-2 text-right">Explained</th>
                  </tr>
                </thead>
                <tbody>
                  {data.teams.map((row) => (
                    <tr key={`${row.teamRunId}:${row.stageOrder}:${row.attempt}:${row.teamRole ?? ""}`} className="border-b border-black/10 last:border-0">
                      <td className="px-3 py-2 font-mono" title={row.teamRunId}>{shortId(row.teamRunId)}</td>
                      <td className="px-3 py-2 tabular-nums">{row.stageOrder}</td>
                      <td className="px-3 py-2 tabular-nums">{row.attempt}</td>
                      <td className="px-3 py-2">{row.teamRole ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{integer.format(row.promptTokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{integer.format(row.completionTokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.coverage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SketchSection>
        )}
        <SketchSection title="Runs by agent">
          <p className="mb-3 text-[12px] text-black/60">Agents are ordered by total tokens. Select a run to inspect context rounds and identifiers.</p>
          {loading ? <SketchBox className="p-8 text-center"><p className={sketchLabel}>Loading detailed usage…</p></SketchBox> : data?.groups.length === 0 ? (
            <SketchBox className="p-8 text-center"><p className="font-serif text-[11px] uppercase tracking-widest text-black/50">No usage recorded for this month</p></SketchBox>
          ) : <div className="space-y-4">{data?.groups.map((group) => {
            const agentOpen = openAgents.has(group.agentId);
            return <SketchBox key={group.agentId} className="overflow-hidden">
              <button type="button" aria-expanded={agentOpen} onClick={() => toggle(setOpenAgents, group.agentId)} className="grid w-full grid-cols-[1fr_auto] gap-4 border-b border-black/15 bg-[#E2F0CC]/45 px-4 py-4 text-left hover:bg-black/[0.03] lg:grid-cols-[minmax(200px,1fr)_repeat(4,minmax(95px,auto))]">
                <span className="flex min-w-0 items-start gap-2"><span className="mt-0.5 shrink-0">{agentOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span><span className="min-w-0"><span className="block truncate text-[14px] font-semibold">{group.agentName}</span><span className="block truncate font-mono text-[10px] text-black/45">{group.agentId}</span></span></span>
                <span className="text-right"><span className="block text-[10px] uppercase tracking-wider text-black/45">Runs</span><span className="tabular-nums">{integer.format(group.totalRuns)}</span></span>
                <span className="hidden text-right lg:block"><span className="block text-[10px] uppercase tracking-wider text-black/45">Input</span><span className="tabular-nums">{integer.format(group.promptTokens)}</span></span>
                <span className="hidden text-right lg:block"><span className="block text-[10px] uppercase tracking-wider text-black/45">Output</span><span className="tabular-nums">{integer.format(group.completionTokens)}</span></span>
                <span className="hidden text-right lg:block"><span className="block text-[10px] uppercase tracking-wider text-black/45">Cost</span><span className="font-mono">{formatDetailedUsageCost(group.providerCostUsd, currency)}</span></span>
              </button>
              {agentOpen && <div className="overflow-x-auto"><table className="w-full min-w-[920px] border-collapse text-left text-[12px]">
                <thead className="border-b border-black/20"><tr><th className="w-8 px-3 py-3"></th><th className={cn(sketchLabel, "px-3 py-3")}>Time</th><th className={cn(sketchLabel, "px-3 py-3")}>Run</th><th className={cn(sketchLabel, "px-3 py-3")}>Provider / model</th><th className={cn(sketchLabel, "px-3 py-3 text-right")}>Input</th><th className={cn(sketchLabel, "px-3 py-3 text-right")}>Output</th><th className={cn(sketchLabel, "px-3 py-3 text-right")}>Total</th><th className={cn(sketchLabel, "px-3 py-3 text-right")}>Provider cost</th></tr></thead>
                <tbody>{group.runs.map((run) => { const runOpen = openRuns.has(run.usageId); const displayId = run.runId ?? run.usageId; return <Fragment key={run.usageId}>
                  <tr className="cursor-pointer border-b border-black/10 hover:bg-black/[0.025]" onClick={() => toggle(setOpenRuns, run.usageId)}>
                    <td className="px-3 py-3">{runOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td className="whitespace-nowrap px-3 py-3"><span className="block">{formatTime(run.startedAt)}</span><span className="text-[10px] text-black/45">{formatDuration(run.durationMs)}</span></td>
                    <td className="px-3 py-3"><span className="block capitalize">{run.status.replaceAll("_", " ")}</span><span className="font-mono text-[10px] text-black/45" title={displayId}>{shortId(displayId)} · {run.roundCount || 1} round{run.roundCount === 1 ? "" : "s"}</span></td>
                    <td className="max-w-[260px] px-3 py-3"><span className="block capitalize">{run.provider ?? "Unknown provider"}</span><span className="block truncate font-mono text-[10px] text-black/45" title={run.model ?? undefined}>{run.model ?? "Unknown model"}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums"><span className="block">{integer.format(run.promptTokens)}</span>{run.cachedPromptTokens > 0 && <span className="text-[10px] text-black/45">{integer.format(run.cachedPromptTokens)} cached</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{integer.format(run.completionTokens)}</td><td className="px-3 py-3 text-right tabular-nums">{integer.format(run.totalTokens)}</td><td className="whitespace-nowrap px-3 py-3 text-right font-mono">{formatDetailedUsageCost(run.providerCostUsd, currency)}</td>
                  </tr>{runOpen && <tr className="border-b border-black/15"><td colSpan={8} className="p-0"><RunDetails run={run} currency={currency} /></td></tr>}
                </Fragment>; })}</tbody>
              </table></div>}
            </SketchBox>;
          })}{data?.truncated && <p className="text-[11px] text-black/50">Showing the 250 most recent usage records for this month.</p>}</div>}
        </SketchSection>
      </>}
    </div>
  );
}
