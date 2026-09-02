"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Briefcase,
  Check,
  ChevronRight,
  Loader2,
  Plug,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  connectorLabel,
  getEmployeeRole,
  hireEmployee,
  preflightEmployeeHire,
  type PreflightResult,
  type RoleCatalogEntry,
} from "@/lib/employees-api";
import {
  connectorsNeededHref,
  EmployeePlatformPicker,
} from "@/components/qlix/ai-employees/EmployeePlatformPicker";
import {
  SketchBox,
  sketchButton,
  sketchButtonPrimary,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import { getCatalogEntry as getPlatformEntry } from "@/lib/connector-catalog";
import { cn } from "@/lib/utils/cn";

const STEPS = [
  { id: "role", label: "Role", hint: "Mission & outcomes", icon: Briefcase },
  { id: "identity", label: "Identity", hint: "Name your employee", icon: UserRound },
  { id: "connections", label: "Connections", hint: "External platforms", icon: Plug },
  { id: "knowledge", label: "Knowledge", hint: "Brain documents", icon: BookOpen },
  { id: "review", label: "Review", hint: "Confirm & hire", icon: Sparkles },
] as const;

function StepIndicator({
  step,
  onGoTo,
}: {
  readonly step: number;
  readonly onGoTo: (index: number) => void;
}) {
  return (
    <>
      {/* Mobile / tablet horizontal stepper */}
      <div className="flex gap-1 lg:hidden">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = i === step;
          const done = i < step;
          return (
            <button
              key={s.id}
              type="button"
              disabled={i > step}
              onClick={() => i < step && onGoTo(i)}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 border-b-2 pb-2 pt-1 transition-colors",
                active ? "border-black text-black" : done ? "border-black/40 text-black/70" : "border-black/10 text-black/35",
                i < step && "cursor-pointer",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate text-[9px] uppercase tracking-wider">{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* Desktop vertical rail */}
      <nav className="hidden lg:flex lg:flex-col lg:gap-1" aria-label="Hire steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = i === step;
          const done = i < step;
          return (
            <button
              key={s.id}
              type="button"
              disabled={i > step}
              onClick={() => i < step && onGoTo(i)}
              className={cn(
                "flex items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors",
                active && "bg-black/[0.04]",
                done && "cursor-pointer hover:bg-black/[0.03]",
                i > step && "cursor-default opacity-45",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                  active
                    ? "border-black bg-black text-white"
                    : done
                      ? "border-green-700/40 bg-green-50 text-green-800"
                      : "border-black/20 bg-[#E2F0CC] text-black/45",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
              </span>
              <span className="min-w-0 pt-0.5">
                <span className={cn("block text-[12px] font-medium", active ? "text-black" : "text-black/70")}>
                  {s.label}
                </span>
                <span className="block text-[11px] text-black/45">{s.hint}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

function HireSummaryPanel({
  role,
  name,
  step,
  selectedPlatformIds,
  preflight,
}: {
  readonly role: RoleCatalogEntry;
  readonly name: string;
  readonly step: number;
  readonly selectedPlatformIds: readonly string[];
  readonly preflight: PreflightResult | null;
}) {
  return (
    <aside className="hidden shrink-0 border-l border-black/10 bg-black/[0.015] xl:flex xl:w-72 xl:flex-col">
      <div className="border-b border-black/10 px-5 py-4">
        <p className={sketchLabel}>Summary</p>
        <p className="mt-2 text-[15px] font-medium text-black">{name.trim() || role.label}</p>
        <p className="text-[12px] text-black/50">{role.label} · AI Employee</p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/45">Progress</p>
          <p className="mt-1 text-[13px] text-black">
            Step {step + 1} of {STEPS.length} — {STEPS[step]?.label}
          </p>
        </div>
        {selectedPlatformIds.length > 0 ? (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/45">Platforms</p>
            <ul className="mt-2 space-y-1.5">
              {selectedPlatformIds.map((id) => {
                const entry = getPlatformEntry(id);
                return (
                  <li key={id} className="text-[12px] text-black/70">
                    {entry?.name ?? id}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : step >= 2 ? (
          <p className="text-[12px] text-black/50">No external platforms selected yet.</p>
        ) : null}
        {preflight ? (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/45">Readiness</p>
            <p className="mt-1 text-[12px] capitalize text-black/70">{preflight.hireMode} mode</p>
            {preflight.connectorsMissing.length > 0 ? (
              <p className="mt-1 text-[11px] text-amber-900">
                {preflight.connectorsMissing.length} connector
                {preflight.connectorsMissing.length === 1 ? "" : "s"} not linked
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function AiEmployeeHireWizard({
  routePrefix,
  roleSlug,
}: {
  readonly routePrefix: "/individual" | "/organization";
  readonly roleSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillPlatformsParam = searchParams.get("platforms") ?? "";
  const prefillName = searchParams.get("name")?.trim() ?? "";
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<RoleCatalogEntry | null>(null);
  const [selectedPlatformIds, setSelectedPlatformIds] = useState<string[]>([]);
  const [platformsInitialized, setPlatformsInitialized] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [name, setName] = useState("");
  const [limitedMode, setLimitedMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getEmployeeRole(roleSlug);
        if (cancelled) return;
        setRole(res.role);
        setName(prefillName || res.role.label);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load role");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleSlug, prefillName]);

  const refreshPreflight = useCallback(
    async (platformIds: string[]) => {
      setPreflightBusy(true);
      try {
        const pf = await preflightEmployeeHire(roleSlug, platformIds);
        setPreflight(pf);
        setLimitedMode(pf.hireMode === "limited");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to check readiness");
      } finally {
        setPreflightBusy(false);
      }
    },
    [roleSlug],
  );

  useEffect(() => {
    if (!platformsInitialized && role) {
      const prefillPlatforms = prefillPlatformsParam
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const defaults = prefillPlatforms.length > 0
        ? prefillPlatforms.filter((id) => role.platformSuggestions.some((s) => s.platformId === id))
        : role.platformSuggestions.map((s) => s.platformId);
      setSelectedPlatformIds(defaults.length > 0 ? defaults : role.platformSuggestions.map((s) => s.platformId));
      setPlatformsInitialized(true);
    }
  }, [role, platformsInitialized, prefillPlatformsParam]);

  useEffect(() => {
    if (!platformsInitialized) return;
    void refreshPreflight(selectedPlatformIds);
  }, [selectedPlatformIds, platformsInitialized, refreshPreflight]);

  const connectorsHref = connectorsNeededHref(routePrefix, selectedPlatformIds);

  const canProceedFromConnections =
    !preflightBusy &&
    (preflight?.hireMode === "full" ||
      preflight?.readiness === "ready" ||
      limitedMode ||
      (preflight?.connectorsRequired.length ?? 0) === 0);

  async function handleHire() {
    if (!role || !preflight) return;
    setBusy(true);
    setError(null);
    try {
      const { engagement } = await hireEmployee({
        roleSlug,
        name: name.trim() || role.label,
        limitedMode: preflight.hireMode === "limited" ? true : limitedMode,
        selectedPlatformIds,
      });
      router.push(`${routePrefix}/ai-employees/${roleSlug}?hired=${engagement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hire failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-black/50">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading role…
        </p>
      </div>
    );
  }

  if (error && !role) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <SketchBox className="max-w-md p-4">
          <p className="text-[13px] text-black">{error}</p>
        </SketchBox>
      </div>
    );
  }

  if (!role) return null;

  const stepMeta = STEPS[step];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <header className="shrink-0 border-b border-black/10 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`${routePrefix}/ai-employees/${roleSlug}`}
              className="inline-flex items-center gap-1 font-serif text-[11px] uppercase tracking-widest text-black/50 hover:text-black/80"
            >
              ← {role.label}
            </Link>
            <h1 className="mt-1 text-[18px] font-medium tracking-tight text-black sm:text-[20px]">
              Bring your {role.label} to life
            </h1>
          </div>
          <div className="hidden items-center gap-2 text-[11px] uppercase tracking-wider text-black/45 sm:flex">
            <span>{step + 1} / {STEPS.length}</span>
            <ChevronRight className="size-3" aria-hidden />
            <span className="text-black/70">{stepMeta?.label}</span>
          </div>
        </div>
        <div className="mt-4 lg:hidden">
          <StepIndicator step={step} onGoTo={setStep} />
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 border-r border-black/10 px-3 py-5 lg:block xl:w-64">
          <StepIndicator step={step} onGoTo={setStep} />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
            {error ? (
              <SketchBox className="mb-5 px-4 py-3">
                <p className="text-[13px] text-black">{error}</p>
              </SketchBox>
            ) : null}

            {step === 0 && (
              <div className="mx-auto max-w-5xl space-y-6">
                <div>
                  <p className={sketchLabel}>Mission</p>
                  <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-black/75">{role.mission}</p>
                </div>
                <div>
                  <p className={sketchLabel}>What success looks like</p>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {role.outcomes.map((o) => (
                      <li key={o.id}>
                        <SketchBox className="flex h-full flex-col p-4">
                          <span className="text-[13px] font-medium text-black">{o.title}</span>
                          {!o.available && o.limitation ? (
                            <span className="mt-1 text-[11px] text-amber-800">{o.limitation}</span>
                          ) : null}
                          <p className="mt-2 flex-1 text-[12px] leading-relaxed text-black/55">{o.doneLooksLike}</p>
                        </SketchBox>
                      </li>
                    ))}
                  </ul>
                </div>
                {role.limitationSummary ? (
                  <p className="rounded border border-amber-500/30 bg-amber-50 px-4 py-3 text-[12px] text-amber-950">
                    {role.limitationSummary}
                  </p>
                ) : null}
                {!role.hireable ? (
                  <p className="text-[13px] text-red-800">
                    This role is not hireable until required capabilities are enabled.
                  </p>
                ) : null}
              </div>
            )}

            {step === 1 && (
              <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-[1fr_280px]">
                <SketchBox className="space-y-4 p-6">
                  <div>
                    <p className={sketchLabel}>Display name</p>
                    <p className="mt-1 text-[12px] text-black/50">
                      How this employee appears in agents, audit logs, and chat.
                    </p>
                  </div>
                  <input
                    className={`${sketchInput} w-full text-[15px]`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    autoFocus
                  />
                  <p className="text-[11px] text-black/40">{name.trim().length}/120 characters</p>
                </SketchBox>
                <SketchBox className="flex flex-col justify-center p-6">
                  <p className={sketchLabel}>Preview</p>
                  <p className="mt-3 text-[17px] font-medium text-black">{name.trim() || role.label}</p>
                  <p className="mt-1 text-[12px] text-black/50">{role.label} · AI Employee</p>
                  <p className="mt-4 text-[11px] leading-relaxed text-black/45">
                    You can rename later from agent settings.
                  </p>
                </SketchBox>
              </div>
            )}

            {step === 2 && (
              <div className="mx-auto max-w-6xl">
                <div className="mb-6 max-w-2xl">
                  <p className={sketchLabel}>External platforms</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-black/65">
                    Which systems should this employee connect to? Pick role suggestions or search the
                    full catalog — the same connectors you link on the Connectors page.
                  </p>
                </div>
                <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
                  <SketchBox className="p-5 sm:p-6">
                    <EmployeePlatformPicker
                      layout="wide"
                      suggestions={role.platformSuggestions}
                      selectedIds={selectedPlatformIds}
                      onChange={setSelectedPlatformIds}
                    />
                  </SketchBox>

                  <div className="space-y-4">
                    <SketchBox className="p-5">
                      <p className={sketchLabel}>Connection status</p>
                      {preflightBusy ? (
                        <p className="mt-3 flex items-center gap-2 text-[12px] text-black/50">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking…
                        </p>
                      ) : preflight ? (
                        <div className="mt-3 space-y-3">
                          {preflight.connectorsRequired.length === 0 ? (
                            <p className="text-[12px] text-black/55">
                              {selectedPlatformIds.length === 0
                                ? "No platforms selected — nothing to connect."
                                : "All selected live connectors are linked."}
                            </p>
                          ) : (
                            <ul className="space-y-2">
                              {preflight.connectorsRequired.map((c) => {
                                const ok = preflight.connectorsConnected.includes(c);
                                return (
                                  <li key={c} className="flex items-center gap-2 text-[13px]">
                                    {ok ? (
                                      <Check className="size-4 text-green-700" aria-hidden />
                                    ) : (
                                      <span className="size-4 rounded-full border border-black/30" aria-hidden />
                                    )}
                                    {connectorLabel(c)}
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          {preflight.connectorsMissing.length > 0 ? (
                            <>
                              <Link href={connectorsHref} className={`${sketchButton} inline-flex w-full justify-center`}>
                                Connect on Connectors page
                              </Link>
                              {preflight.hireMode === "limited" ? (
                                <label className="flex items-start gap-2 text-[12px] leading-relaxed text-black/70">
                                  <input
                                    type="checkbox"
                                    checked={limitedMode}
                                    onChange={(e) => setLimitedMode(e.target.checked)}
                                    className="mt-0.5"
                                  />
                                  Hire in limited mode without all connectors
                                </label>
                              ) : null}
                            </>
                          ) : null}

                          {preflight.soonPlatformIds.length > 0 ? (
                            <p className="text-[11px] leading-relaxed text-black/55">
                              {preflight.soonPlatformIds
                                .map((id) => getPlatformEntry(id)?.name ?? id)
                                .join(", ")}{" "}
                              — connect flow coming soon.
                            </p>
                          ) : null}

                          {preflight.missingCapabilityScopes.length > 0 ? (
                            <p className="text-[12px] text-amber-900">
                              Enable skills: {preflight.missingCapabilityScopes.join(", ")}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </SketchBox>

                    <SketchBox className="p-5">
                      <p className={sketchLabel}>Tip</p>
                      <p className="mt-2 text-[12px] leading-relaxed text-black/55">
                        Connectors are shared across your workspace. Link once on the Connectors page
                        and every employee can use them.
                      </p>
                    </SketchBox>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="mx-auto max-w-4xl space-y-6">
                <div>
                  <p className={sketchLabel}>Knowledge (recommended)</p>
                  <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-black/65">
                    Upload documents to AI Brain so this employee can answer from your policies,
                    playbooks, and product docs.
                  </p>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {role.knowledgeRequirements.map((k) => (
                    <li key={k.id}>
                      <SketchBox className="flex h-full flex-col p-4">
                        <span className="text-[13px] font-medium text-black">{k.label}</span>
                        <span className="mt-1 text-[11px] uppercase tracking-wider text-black/45">
                          {k.required ? "Required for full mode" : "Recommended"}
                        </span>
                      </SketchBox>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Link href={`${routePrefix}/ai-brain`} className={`${sketchButtonPrimary} inline-flex`}>
                    Open AI Brain
                  </Link>
                  <p className="self-center text-[12px] text-black/45">You can upload after hiring.</p>
                </div>
              </div>
            )}

            {step === 4 && preflight && (
              <div className="mx-auto max-w-4xl">
                <p className={sketchLabel}>Review & hire</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <SketchBox className="p-5">
                    <p className="text-[10px] uppercase tracking-wider text-black/45">Employee</p>
                    <p className="mt-2 text-[16px] font-medium text-black">{name.trim() || role.label}</p>
                    <p className="text-[12px] text-black/50">{role.label}</p>
                  </SketchBox>
                  <SketchBox className="p-5">
                    <p className="text-[10px] uppercase tracking-wider text-black/45">Mode</p>
                    <p className="mt-2 text-[16px] font-medium capitalize text-black">{preflight.hireMode}</p>
                    <p className="text-[12px] text-black/50">Pack {preflight.packVersion}</p>
                  </SketchBox>
                  <SketchBox className="p-5 sm:col-span-2">
                    <p className="text-[10px] uppercase tracking-wider text-black/45">Platforms</p>
                    {selectedPlatformIds.length > 0 ? (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {selectedPlatformIds.map((id) => (
                          <li
                            key={id}
                            className="rounded-full border border-black/15 px-3 py-1 text-[12px] text-black/70"
                          >
                            {getPlatformEntry(id)?.name ?? id}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[13px] text-black/55">None — Brain and chat only.</p>
                    )}
                  </SketchBox>
                  <SketchBox className="p-5 sm:col-span-2">
                    <p className="text-[10px] uppercase tracking-wider text-black/45">Permissions</p>
                    <p className="mt-2 text-[13px] text-black/70">
                      {preflight.resolvedScopes.length} scopes
                      {preflight.resolvedJitScopes.length > 0
                        ? ` · asks before: ${preflight.resolvedJitScopes.join(", ")}`
                        : ""}
                    </p>
                  </SketchBox>
                </div>
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <footer className="shrink-0 border-t border-black/10 bg-[#E2F0CC]/80 px-4 py-3 backdrop-blur-sm sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {step > 0 ? (
                  <button type="button" className={sketchButton} disabled={busy} onClick={() => setStep((s) => s - 1)}>
                    Back
                  </button>
                ) : (
                  <Link href={`${routePrefix}/ai-employees/${roleSlug}`} className={sketchButton}>
                    Cancel
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-2">
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    className={sketchButtonPrimary}
                    disabled={
                      busy ||
                      (step === 0 && !role.hireable) ||
                      (step === 2 && !canProceedFromConnections)
                    }
                    onClick={() => setStep((s) => s + 1)}
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    type="button"
                    className={sketchButtonPrimary}
                    disabled={busy || !role.hireable}
                    onClick={() => void handleHire()}
                  >
                    {busy ? "Hiring…" : "Hire employee"}
                  </button>
                )}
              </div>
            </div>
          </footer>
        </div>

        <HireSummaryPanel
          role={role}
          name={name}
          step={step}
          selectedPlatformIds={selectedPlatformIds}
          preflight={preflight}
        />
      </div>
    </div>
  );
}
