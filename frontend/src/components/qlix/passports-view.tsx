"use client";

import Link from "next/link";
import { useState } from "react";
import { Fingerprint, Globe2, KeyRound, ShieldCheck } from "lucide-react";
import { usePassportsOverview } from "@/lib/hooks/use-passports-overview";
import { getPassportUsageDemo } from "@/lib/passport-usage-demo";
import type { PassportRow } from "@/lib/passports-api";
import { cn } from "@/lib/utils/cn";
import { ReflectiveCard } from "./ReflectiveCard";
import { CopyDidButton } from "./passports/CopyDidButton";
import { AgentPassportModal } from "./passports/AgentPassportModal";

function PassportServiceUsagePanel({ passport }: { readonly passport: PassportRow }) {
  const u = getPassportUsageDemo(passport.agentId);

  return (
    <ReflectiveCard className="rounded-xl" contentClassName="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-[--border-subtle] pb-3">
        <div>
          <h3 className="text-[13px] font-medium text-[--text-primary]">
            Passport:{" "}
            <span className="font-mono text-[12px] font-normal text-[--text-secondary]" title={passport.did}>
              {passport.didShort}
            </span>
          </h3>
          <p className="mt-0.5 font-mono text-[11px] text-[--text-tertiary]" title={passport.did}>
            {passport.did}
          </p>
        </div>
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200/90">
          Demo data
        </span>
      </div>

      <ul className="space-y-1.5 font-mono text-[12px] leading-relaxed text-[--text-secondary]">
        <li>
          <span className="select-none text-[--text-tertiary]">├─</span> Total usages:{" "}
          <span className="font-medium text-[--text-primary]">{u.totalUsages}</span>
        </li>
        <li>
          <span className="select-none text-[--text-tertiary]">├─</span> Success rate:{" "}
          <span className="font-medium text-[--text-primary]">{u.successRatePct}%</span>
        </li>
        <li>
          <span className="select-none text-[--text-tertiary]">├─</span> Last used:{" "}
          <span className="font-medium text-[--text-primary]">{u.lastUsedLabel}</span>
        </li>
        <li>
          <span className="select-none text-[--text-tertiary]">├─</span> Most common website:{" "}
          <span className="font-medium text-[--text-primary]">
            {u.topWebsite} ({u.topWebsiteUses} uses)
          </span>
        </li>
        <li>
          <span className="select-none text-[--text-tertiary]">├─</span> Friction reduced:{" "}
          <span className="font-medium text-[--text-primary]">{u.captchasBypassed} CAPTCHAs bypassed</span>
        </li>
        <li className="text-[--text-tertiary]">
          <span className="select-none">└─</span> Usage timeline (last 10)
        </li>
      </ul>

      <div className="mt-3 overflow-hidden rounded-lg border border-[--border-subtle]">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[--border-subtle] bg-[--bg-subtle] text-[10px] font-medium uppercase tracking-widest text-[--text-tertiary]">
              <th className="px-3 py-2">Timestamp</th>
              <th className="px-3 py-2">Website</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">CAPTCHA bypass</th>
            </tr>
          </thead>
          <tbody>
            {u.timeline.map((row, idx) => (
              <tr
                key={`${passport.agentId}-${row.timestamp}-${idx}`}
                className={cn(
                  "border-b border-[--border-subtle] last:border-0",
                  idx % 2 === 1 ? "bg-[--bg-base]/40" : "",
                )}
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-[--text-secondary]">
                  {row.timestamp}
                </td>
                <td className="px-3 py-2 text-[--text-secondary]">{row.website}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-[--text-tertiary]">{row.action}</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium capitalize",
                      row.result === "success"
                        ? "bg-green-950/40 text-green-400"
                        : "bg-red-950/40 text-red-400",
                    )}
                  >
                    {row.result}
                  </span>
                </td>
                <td className="px-3 py-2 text-[--text-secondary]">{row.captchaBypassed ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[--text-tertiary]">
        Each row reflects a client request carrying <span className="font-mono">X-Exora-Identity</span>, website
        validation, scope checks, trust decision, and action outcome. Values are placeholders until ingest is
        connected.
      </p>
    </ReflectiveCard>
  );
}

export function PassportsView({ routePrefix }: { readonly routePrefix: "/individual" | "/organization" }) {
  const { data, error, loading, refresh } = usePassportsOverview();
  const [selected, setSelected] = useState<PassportRow | null>(null);

  if (loading) {
    return (
      <div className="animate-qlix-fade-in">
        <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">Passports</h1>
        <p className="mt-2 text-[13px] text-[--text-tertiary]">Loading Layer 3 identity…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="animate-qlix-fade-in space-y-3">
        <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">Passports</h1>
        <p className="text-[13px] text-[--danger]">{error ?? "Something went wrong."}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[13px] font-medium text-[--accent] hover:text-[--accent-hover]"
        >
          Retry
        </button>
      </div>
    );
  }

  const orgKind =
    data.workspaceKind === "organization" ? "organization workspace" : "personal workspace";

  return (
    <div className="animate-qlix-fade-in flex flex-col gap-10">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="qlix-glass-muted flex size-9 items-center justify-center rounded-lg text-[--accent]">
            <Fingerprint className="size-[18px]" strokeWidth={1.75} aria-hidden />
          </div>
          <div>
            <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">Passports</h1>
            <p className="text-[13px] text-[--text-secondary]">
              Exora Layer 3 — cryptographic agent identities for {data.organization.name} ({orgKind})
            </p>
          </div>
        </div>
        <p className="max-w-2xl text-[13px] leading-relaxed text-[--text-tertiary]">
          Each passport binds an agent to a DID, public verification material, and (when issued) Verifiable Credentials.
          Resolver consumers and auditors use this identity layer to certify who acted on behalf of whom.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <ReflectiveCard className="rounded-xl" contentClassName="p-5">
          <div className="mb-3 flex items-center gap-2 text-[--text-secondary]">
            <Globe2 className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-widest">DID &amp; document</span>
          </div>
          <p className="text-[13px] leading-relaxed text-[--text-tertiary]">
            Agents are registered with a unique DID. The DID document describes verification methods (for example
            linked public keys) used to prove control of the identity.
          </p>
        </ReflectiveCard>
        <ReflectiveCard className="rounded-xl" contentClassName="p-5">
          <div className="mb-3 flex items-center gap-2 text-[--text-secondary]">
            <ShieldCheck className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-widest">Verifiable credentials</span>
          </div>
          <p className="text-[13px] leading-relaxed text-[--text-tertiary]">
            Your workspace can issue VCs that assert agent roles, scopes, and certification. Revocation and expiry are
            checked before high-risk actions.
          </p>
        </ReflectiveCard>
        <ReflectiveCard className="rounded-xl" contentClassName="p-5">
          <div className="mb-3 flex items-center gap-2 text-[--text-secondary]">
            <KeyRound className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-widest">Trust &amp; audit</span>
          </div>
          <p className="text-[13px] leading-relaxed text-[--text-tertiary]">
            Layer 3 feeds Layer 5: every action can be attributed to a DID-backed agent. Passports are the records you
            inspect when proving compliance.
          </p>
        </ReflectiveCard>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-medium text-[--text-primary]">Passport registry</h2>
            <p className="mt-1 text-[12px] text-[--text-tertiary]">
              Active agents in this workspace and their Layer 3 bindings
            </p>
          </div>
          <Link
            href={`${routePrefix}/agents`}
            className="text-[12px] font-medium text-[--accent] transition-colors hover:text-[--accent-hover]"
          >
            Manage agents →
          </Link>
        </div>

        <ReflectiveCard className="w-full overflow-hidden rounded-xl">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="qlix-glass-inset border-b border-[--border-subtle]">
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  Agent
                </th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  DID
                </th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  Verification material
                </th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  VCs
                </th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {data.passports.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-[--text-tertiary]">
                    No agents yet.{" "}
                    <Link href={`${routePrefix}/agents`} className="font-medium text-[--accent] hover:text-[--accent-hover]">
                      Register an agent
                    </Link>{" "}
                    to create its passport.
                  </td>
                </tr>
              ) : (
                data.passports.map((row) => (
                  <tr
                    key={row.agentId}
                    className="border-b border-[--border-subtle] transition-colors last:border-0 hover:bg-[var(--glass-row-hover)]"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        className="text-left text-[13px] font-medium text-[--text-primary] transition-colors hover:text-[--accent]"
                        title="View passport"
                      >
                        {row.name}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="font-mono text-[12px] text-[--text-secondary]"
                          title={row.did}
                        >
                          {row.didShort}
                        </span>
                        <CopyDidButton value={row.did} />
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[--text-tertiary]" title={row.publicKeyFull}>
                      {row.publicKeyShort}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[--text-secondary]">{row.credentialsIssued}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize",
                          row.status === "active"
                            ? "border-green-900/50 bg-green-950/20 text-green-500"
                            : "border-[--border-subtle] text-[--text-tertiary]",
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ReflectiveCard>
        <p className="text-[12px] text-[--text-tertiary]">
          VC counts will populate when the issuer store is connected. Until then, identities are DID + key material from
          registration.
        </p>
      </section>

      {data.passports.length > 0 ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-[13px] font-medium text-[--text-primary]">Passport service usage</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[--text-tertiary]">
              When a site trusts an agent passport (<span className="font-mono">X-Exora-Identity</span>), validation,
              scopes, website decision, and action result can be logged per usage. Below is a preview per passport (demo
              metrics and last 10 events).
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-1">
            {data.passports.map((row) => (
              <PassportServiceUsagePanel key={`usage-${row.agentId}`} passport={row} />
            ))}
          </div>
        </section>
      ) : null}

      {selected ? (
        <AgentPassportModal
          passport={selected}
          routePrefix={routePrefix}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
