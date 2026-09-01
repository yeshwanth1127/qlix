"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { PassportRow } from "@/lib/passports-api";
import { cn } from "@/lib/utils/cn";
import { CopyDidButton } from "./CopyDidButton";
import { ExoraPassportCard } from "./ExoraPassportCard";

const MRZ_WIDTH = 36;

/** Date-only label, e.g. "30 Apr 2026". */
function formatPassportDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(d);
}

/** `<`-pad / truncate a token row to the fixed MRZ width. */
function mrzRow(parts: string): string {
  const cleaned = parts.toUpperCase().replace(/[^A-Z0-9<]/g, "<");
  return cleaned.slice(0, MRZ_WIDTH).padEnd(MRZ_WIDTH, "<");
}

/** Two machine-readable-zone lines derived from real holder + DID values. Decorative. */
function buildMrz(name: string, did: string): readonly [string, string] {
  const nameToken = name.trim().replace(/\s+/g, "<");
  const didToken = did.replace(/[^A-Za-z0-9]/g, "");
  return [mrzRow(`P<EXORA<${nameToken}`), mrzRow(didToken)];
}

interface AgentPassportModalProps {
  readonly passport: PassportRow;
  readonly routePrefix: "/individual" | "/organization";
  readonly onClose: () => void;
}

export function AgentPassportModal({ passport, routePrefix, onClose }: AgentPassportModalProps) {
  // Escape to close + lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const isActive = passport.status.toLowerCase() === "active";
  const [mrz1, mrz2] = buildMrz(passport.name, passport.did);

  return (
    <div
      className="animate-qlix-fade-in fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#171223]/45 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Passport for ${passport.name}`}
      onClick={onClose}
    >
      <div
        className="passport-card-in flex w-full max-w-3xl flex-col items-center gap-5 md:flex-row md:items-stretch"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left page — passport cover */}
        <div className="flex items-center justify-center md:shrink-0">
          <ExoraPassportCard
            className="w-[min(320px,84vw)]"
            name={passport.name}
            subtitle="Layer 3 Identity"
            didShort={passport.didShort}
          />
        </div>

        {/* Right page — data page */}
        <div className="flex min-w-0 flex-1 flex-col rounded-3xl border border-[#221c33]/12 bg-gradient-to-b from-[#fffdf8] to-[#f6f2e9] p-5 shadow-[0_1px_1px_rgba(28,24,48,0.05),0_30px_80px_-32px_rgba(28,24,48,0.5),inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-6">
          <div className="flex items-center justify-between border-b border-[#221c33]/10 pb-3">
            <div className="flex items-baseline gap-2.5">
              <span className="font-serif text-[14px] tracking-[0.3em] text-[#221c33]">EXORA</span>
              <span className="text-[9px] font-medium uppercase tracking-[0.3em] text-[#221c33]/45">
                Passport
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-7 items-center justify-center rounded-full border border-[#221c33]/12 bg-[#E2F0CC]/60 text-[#221c33]/50 transition-colors hover:border-[#221c33]/30 hover:text-[#221c33]"
              aria-label="Close passport"
            >
              <X className="size-[15px]" aria-hidden />
            </button>
          </div>

          <p className="mt-3 text-[9px] font-medium uppercase tracking-[0.32em] text-[#221c33]/45">
            Digital Agent Passport
          </p>

          <dl className="mt-4 space-y-3.5">
            <Field label="Holder">
              <span className="font-serif text-[16px] tracking-[-0.01em] text-[#221c33]">{passport.name}</span>
            </Field>

            <Field label="Passport No.">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-[12px] text-[#221c33]/70" title={passport.did}>
                  {passport.didShort}
                </span>
                <CopyDidButton value={passport.did} />
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3.5">
              <Field label="Status">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
                    isActive
                      ? "border-[#15803d]/25 bg-[#15803d]/[0.07] text-[#15803d]"
                      : "border-[#221c33]/15 bg-[#E2F0CC]/50 text-[#221c33]/60",
                  )}
                >
                  {isActive ? <span className="size-1.5 rounded-full bg-[#15803d]" aria-hidden /> : null}
                  {passport.status}
                </span>
              </Field>

              <Field label="Credentials">
                <span className="text-[13px] text-[#221c33]">
                  {passport.credentialsIssued} {passport.credentialsIssued === 1 ? "VC" : "VCs"}
                </span>
              </Field>

              <Field label="Issued">
                <span className="text-[13px] text-[#221c33]">{formatPassportDate(passport.createdAt)}</span>
              </Field>

              <Field label="Last active">
                <span className="text-[13px] text-[#221c33]">{formatPassportDate(passport.lastActiveAt)}</span>
              </Field>
            </div>
          </dl>

          {/* Machine-readable zone */}
          <div className="mt-4 overflow-hidden rounded-lg border border-[#221c33]/10 bg-[#f1ede1] px-3 py-2">
            <pre className="overflow-hidden font-mono text-[11px] leading-relaxed tracking-[0.18em] text-[#221c33]/45">
              {mrz1}
              {"\n"}
              {mrz2}
            </pre>
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 pt-4">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#221c33]/40">
              Issued by Exora · Layer 3
            </span>
            <Link
              href={`${routePrefix}/agents/${passport.agentId}`}
              className="shrink-0 text-[12px] font-medium text-[#221c33] underline-offset-4 transition-colors hover:underline"
            >
              View full agent details →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[9px] font-medium uppercase tracking-[0.28em] text-[#221c33]/40">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
