"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Loader2, Search, ShieldAlert, Users } from "lucide-react";
import {
  ALL_PERMISSION_SCOPES,
  FORCE_JIT_SCOPES,
  PERMISSION_SCOPE_LABELS,
  fetchScopeCatalog,
  type PermissionScope,
} from "@/lib/agents-api";
import {
  CAPABILITY_GROUPS,
  GROUPED_SCOPE_IDS,
  productSelectionState,
  type CapabilityProduct,
} from "@/lib/capability-groups";
import { scopesRequireHybrid } from "@/lib/agent-runtime";
import type { AgentCreationPlan, NLAgentSpec, NLWorkerSpec } from "@/lib/nl-builder-api";
import { sketchInput } from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";

type MemberKey = "single" | "supervisor" | `worker-${number}`;

interface ScopeOption {
  id: string;
  label: string;
  description: string;
  forceJit: boolean;
}

interface AddCapabilitiesPanelProps {
  readonly plan: AgentCreationPlan;
  readonly orgId: string | null;
  readonly onPlanChange: (plan: AgentCreationPlan) => void;
}

function applyRuntimeForScopes(
  spec: NLAgentSpec | NLWorkerSpec,
  permissionScopes: PermissionScope[],
): Partial<NLAgentSpec> {
  if (!scopesRequireHybrid(permissionScopes) || spec.runtime === "hybrid" || spec.runtime === "local") {
    return {};
  }
  return { runtime: "hybrid", llmMode: "proxy", localInferenceMode: null };
}

function toggleScopeOnSpec(
  spec: NLAgentSpec | NLWorkerSpec,
  scopeId: string,
  forceJit: boolean,
): Partial<NLAgentSpec> {
  const scope = scopeId as PermissionScope;
  const has = spec.permissionScopes.includes(scope);
  let permissionScopes: PermissionScope[];
  let jitScopes: PermissionScope[];
  if (has) {
    permissionScopes = spec.permissionScopes.filter((s) => s !== scope);
    jitScopes = spec.jitScopes.filter((s) => s !== scope);
  } else {
    permissionScopes = [...spec.permissionScopes, scope];
    const mustJit = forceJit || FORCE_JIT_SCOPES.includes(scope as never);
    jitScopes = mustJit
      ? [...spec.jitScopes.filter((s) => s !== scope), scope]
      : spec.jitScopes;
  }
  return {
    permissionScopes,
    jitScopes,
    ...applyRuntimeForScopes(spec, permissionScopes),
  };
}

function toggleProductOnSpec(
  spec: NLAgentSpec | NLWorkerSpec,
  product: CapabilityProduct,
): Partial<NLAgentSpec> {
  const state = productSelectionState(product, spec.permissionScopes);
  const productScopeSet = new Set<string>(product.scopes);
  const forceJitSet = new Set<string>(product.forceJitScopes);
  let permissionScopes: PermissionScope[];
  let jitScopes: PermissionScope[];

  if (state === "all") {
    permissionScopes = spec.permissionScopes.filter((s) => !productScopeSet.has(s));
    jitScopes = spec.jitScopes.filter((s) => !productScopeSet.has(s));
  } else {
    const next = new Set(spec.permissionScopes);
    for (const s of product.scopes) next.add(s);
    permissionScopes = Array.from(next) as PermissionScope[];
    const nextJit = new Set(spec.jitScopes);
    for (const s of product.scopes) {
      if (forceJitSet.has(s) || FORCE_JIT_SCOPES.includes(s as never)) nextJit.add(s);
    }
    jitScopes = Array.from(nextJit) as PermissionScope[];
  }

  return {
    permissionScopes,
    jitScopes,
    ...applyRuntimeForScopes(spec, permissionScopes),
  };
}

function memberSpec(plan: AgentCreationPlan, key: MemberKey): NLAgentSpec | NLWorkerSpec {
  if (plan.type === "single") return plan.agent;
  if (key === "supervisor") return plan.team.supervisor;
  const idx = Number(key.replace("worker-", ""));
  return plan.team.workers[idx] ?? plan.team.supervisor;
}

function matchesQuery(
  query: string,
  ...fields: string[]
): boolean {
  if (!query) return true;
  return fields.some((f) => f.toLowerCase().includes(query));
}

export function AddCapabilitiesPanel({ plan, orgId, onPlanChange }: AddCapabilitiesPanelProps) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof fetchScopeCatalog>>>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [memberKey, setMemberKey] = useState<MemberKey>(
    plan.type === "single" ? "single" : "supervisor",
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CAPABILITY_GROUPS.map((g) => [g.id, true])),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchScopeCatalog(orgId).then((rows) => {
      if (cancelled) return;
      setCatalog(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (plan.type === "single") {
      setMemberKey("single");
      return;
    }
    setMemberKey((cur) => (cur === "single" ? "supervisor" : cur));
  }, [plan]);

  const members = useMemo(() => {
    if (plan.type === "single") {
      return [{ key: "single" as const, label: plan.agent.name || "Agent" }];
    }
    return [
      { key: "supervisor" as const, label: plan.team.supervisor.name || "Supervisor" },
      ...plan.team.workers.map((w, i) => ({
        key: `worker-${i}` as const,
        label: w.name || w.role || `Worker ${i + 1}`,
      })),
    ];
  }, [plan]);

  const scopeOptions = useMemo(() => {
    const map = new Map<string, ScopeOption>();
    for (const id of ALL_PERMISSION_SCOPES) {
      map.set(id, {
        id,
        label: PERMISSION_SCOPE_LABELS[id] ?? id,
        description: "",
        forceJit: FORCE_JIT_SCOPES.includes(id),
      });
    }
    for (const row of catalog ?? []) {
      map.set(row.id, {
        id: row.id,
        label: row.label || row.id,
        description: row.description || "",
        forceJit: row.forceJit,
      });
    }
    const active = memberSpec(plan, memberKey);
    for (const id of active.permissionScopes) {
      if (!map.has(id)) {
        map.set(id, { id, label: id, description: "Currently on this agent", forceJit: false });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aMcp = a.id.startsWith("mcp.") ? 1 : 0;
      const bMcp = b.id.startsWith("mcp.") ? 1 : 0;
      if (aMcp !== bMcp) return aMcp - bMcp;
      return a.id.localeCompare(b.id);
    });
  }, [catalog, plan, memberKey]);

  const q = query.trim().toLowerCase();

  const visibleGroups = useMemo(() => {
    return CAPABILITY_GROUPS.map((group) => {
      const products = group.products.filter((p) =>
        matchesQuery(q, group.label, p.label, p.description, ...p.scopes),
      );
      return { ...group, products };
    }).filter((g) => g.products.length > 0);
  }, [q]);

  const filteredUngrouped = useMemo(() => {
    return scopeOptions.filter((s) => {
      if (GROUPED_SCOPE_IDS.has(s.id)) return false;
      return matchesQuery(q, s.id, s.label, s.description);
    });
  }, [scopeOptions, q]);

  const activeSpec = memberSpec(plan, memberKey);
  const selectedCount = activeSpec.permissionScopes.length;

  const patchMember = (patch: Partial<NLAgentSpec>) => {
    if (plan.type === "single") {
      onPlanChange({ ...plan, agent: { ...plan.agent, ...patch } as NLAgentSpec });
      return;
    }
    if (memberKey === "supervisor") {
      onPlanChange({
        ...plan,
        team: {
          ...plan.team,
          supervisor: { ...plan.team.supervisor, ...patch } as NLAgentSpec,
        },
      });
      return;
    }
    const idx = Number(memberKey.replace("worker-", ""));
    const workers = plan.team.workers.map((w, i) =>
      i === idx ? ({ ...w, ...patch } as NLWorkerSpec) : w,
    );
    onPlanChange({ ...plan, team: { ...plan.team, workers } });
  };

  const toggle = (opt: ScopeOption) => {
    patchMember(toggleScopeOnSpec(activeSpec, opt.id, opt.forceJit));
  };

  const toggleProduct = (product: CapabilityProduct) => {
    patchMember(toggleProductOnSpec(activeSpec, product));
  };

  const empty = visibleGroups.length === 0 && filteredUngrouped.length === 0;

  return (
    <div className="qlix-msg-in space-y-3 rounded-2xl border border-black/12 bg-[#E2F0CC]/75 p-3 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#012F13]">
            Add capabilities
          </p>
          <p className="mt-0.5 text-[11px] text-black/50">
            All platform scopes{plan.type === "team" ? " — pick a team member, then toggle scopes" : ""}.
            {selectedCount > 0 ? ` ${selectedCount} selected on this agent.` : ""}
          </p>
        </div>
        {loading ? <Loader2 className="size-4 animate-spin text-black/40" aria-hidden /> : null}
      </div>

      {plan.type === "team" ? (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Team member">
          {members.map((m) => {
            const active = m.key === memberKey;
            const isSupervisor = m.key === "supervisor";
            return (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMemberKey(m.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium motion-safe:transition-colors",
                  active
                    ? "border-[#012F13] bg-[#012F13] text-white"
                    : "border-black/15 bg-[#E2F0CC]/80 text-[#012F13] hover:border-[#012F13]/40",
                )}
              >
                {isSupervisor ? (
                  <Users className="size-3 opacity-80" aria-hidden />
                ) : (
                  <Bot className="size-3 opacity-80" aria-hidden />
                )}
                {m.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-black/40"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search scopes…"
          className={`${sketchInput} !py-2 !pl-8 !text-[12px]`}
        />
      </div>

      <ul className="max-h-72 space-y-0.5 overflow-y-auto overscroll-contain rounded-xl border border-black/10 bg-[#E2F0CC]/90 py-1">
        {empty ? (
          <li className="px-3 py-6 text-center text-[11px] text-black/45">No matching scopes</li>
        ) : (
          <>
            {visibleGroups.map((group) => {
              const open = openGroups[group.id] !== false;
              return (
                <li key={group.id} className="border-b border-black/6 last:border-b-0">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((prev) => ({ ...prev, [group.id]: !open }))
                    }
                    aria-expanded={open}
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-black/[0.03]"
                  >
                    {open ? (
                      <ChevronDown className="size-3.5 shrink-0 text-black/45" aria-hidden />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 text-black/45" aria-hidden />
                    )}
                    <span className="text-[12px] font-semibold text-[#012F13]">{group.label}</span>
                    <span className="text-[10px] text-black/40">{group.products.length}</span>
                  </button>
                  {open ? (
                    <ul className="pb-1">
                      {group.products.map((product) => {
                        const state = productSelectionState(product, activeSpec.permissionScopes);
                        const checked = state === "all";
                        const needsApproval = product.forceJitScopes.length > 0;
                        return (
                          <li key={product.id}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-start gap-2.5 py-2 pl-8 pr-3 transition-colors hover:bg-black/[0.03]",
                                checked && "bg-black/[0.02]",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                ref={(el) => {
                                  if (el) el.indeterminate = state === "some";
                                }}
                                onChange={() => toggleProduct(product)}
                                className="mt-0.5 size-3.5 shrink-0 accent-[#012F13]"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[12px] font-medium text-[#012F13]">
                                    {product.label}
                                  </span>
                                  {needsApproval ? (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider text-black/45">
                                      <ShieldAlert className="size-2.5" aria-hidden />
                                      Approval
                                    </span>
                                  ) : null}
                                </span>
                                <span className="mt-0.5 block text-[11px] leading-snug text-black/55">
                                  {product.description}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}

            {filteredUngrouped.map((opt) => {
              const checked = activeSpec.permissionScopes.includes(opt.id as PermissionScope);
              return (
                <li key={opt.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 px-3 py-2 transition-colors hover:bg-black/[0.03]",
                      checked && "bg-black/[0.02]",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(opt)}
                      className="mt-0.5 size-3.5 shrink-0 accent-[#012F13]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] text-[#012F13]">{opt.id}</span>
                        {opt.forceJit ? (
                          <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider text-black/45">
                            <ShieldAlert className="size-2.5" aria-hidden />
                            Approval
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-black/55">
                        {opt.label}
                        {opt.description && opt.description !== opt.label
                          ? ` — ${opt.description}`
                          : null}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </>
        )}
      </ul>
    </div>
  );
}
