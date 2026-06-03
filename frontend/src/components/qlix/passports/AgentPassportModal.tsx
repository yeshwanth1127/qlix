"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { PassportRow } from "@/lib/passports-api";
import { cn } from "@/lib/utils/cn";
import { CopyDidButton } from "./CopyDidButton";
import { ProfileCard } from "./ProfileCard";

const MRZ_WIDTH = 36;

/** Repeating Exora-mark foil, used as the holographic shine mask (luminance). */
const FOIL_PATTERN =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'>` +
      `<g fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'>` +
      `<path d='M32 8 50 19v22L32 52 14 41V19Z'/>` +
      `<path d='M24 26 40 38M40 26 24 38' stroke-linecap='round'/>` +
      `</g></svg>`,
  );

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

  const emblem = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        paddingBottom: "24%",
      }}
    >
      {/* Circular seal medallion — the logo's white background reads as the seal face */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 170,
          height: 170,
          borderRadius: "9999px",
          background: "radial-gradient(circle at 50% 36%, #ffffff 0%, #f1f0f6 72%, #e7e5ef 100%)",
          border: "4px solid rgba(255,255,255,0.18)",
          boxShadow: "0 12px 36px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.65)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local static seal asset */}
        <img
          src="/exora-logo.jpeg"
          alt="Exora"
          width={122}
          height={122}
          style={{ display: "block", width: 122, height: 122, objectFit: "contain", borderRadius: "9999px" }}
        />
      </div>
    </div>
  );

  return (
    <div
      className="animate-qlix-fade-in fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Passport for ${passport.name}`}
      onClick={onClose}
    >
      <div
        className="passport-card-in flex w-full max-w-3xl flex-col items-stretch gap-4 md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left page — holographic identity card */}
        <div className="flex justify-center md:shrink-0">
          <ProfileCard
            className="h-[460px] sm:h-[500px]"
            name={passport.name}
            title="Layer 3 Identity"
            showUserInfo={false}
            enableTilt
            enableMobileTilt={false}
            behindGlowEnabled
            behindGlowColor="rgba(59,130,246,0.55)"
            iconUrl={FOIL_PATTERN}
            innerGradient="linear-gradient(145deg, rgba(59,130,246,0.18) 0%, rgba(99,102,241,0.10) 100%)"
            avatarNode={emblem}
          />
        </div>

        {/* Right page — data page */}
        <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-[--border-default] bg-[--bg-overlay] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.6)] sm:p-6">
          <div className="flex items-center justify-between border-b border-[--border-subtle] pb-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[13px] font-medium tracking-[0.25em] text-[--text-primary]">EXORA</span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-[--text-tertiary]">Passport</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="qlix-glass-muted inline-flex size-7 items-center justify-center rounded-md text-[--text-tertiary] transition-colors hover:bg-[var(--glass-surface-bg-hover)] hover:text-[--text-primary]"
              aria-label="Close passport"
            >
              <X className="size-[15px]" aria-hidden />
            </button>
          </div>

          <p className="mt-3 text-[10px] font-medium uppercase tracking-widest text-[--text-tertiary]">
            Digital Agent Passport
          </p>

          <dl className="mt-4 space-y-3.5">
            <Field label="Holder">
              <span className="text-[15px] font-medium tracking-[-0.01em] text-[--text-primary]">{passport.name}</span>
            </Field>

            <Field label="Passport No.">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-[12px] text-[--text-secondary]" title={passport.did}>
                  {passport.didShort}
                </span>
                <CopyDidButton value={passport.did} />
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3.5">
              <Field label="Status">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize",
                    isActive ? "bg-[--success-subtle] text-[--success]" : "bg-[var(--glass-muted-bg)] text-[--text-secondary]",
                  )}
                >
                  {isActive ? <span className="size-1.5 rounded-full bg-[--success]" aria-hidden /> : null}
                  {passport.status}
                </span>
              </Field>

              <Field label="Credentials">
                <span className="text-[13px] text-[--text-primary]">
                  {passport.credentialsIssued} {passport.credentialsIssued === 1 ? "VC" : "VCs"}
                </span>
              </Field>

              <Field label="Issued">
                <span className="text-[13px] text-[--text-primary]">{formatPassportDate(passport.createdAt)}</span>
              </Field>

              <Field label="Last active">
                <span className="text-[13px] text-[--text-primary]">{formatPassportDate(passport.lastActiveAt)}</span>
              </Field>
            </div>
          </dl>

          {/* Machine-readable zone */}
          <div className="mt-4 overflow-hidden rounded-md border border-[--border-subtle] bg-black/25 px-3 py-2">
            <pre className="overflow-hidden font-mono text-[11px] leading-relaxed tracking-[0.18em] text-[--text-tertiary]">
              {mrz1}
              {"\n"}
              {mrz2}
            </pre>
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 pt-4">
            <span className="text-[11px] text-[--text-tertiary]">Issued by Exora · Layer 3</span>
            <Link
              href={`${routePrefix}/agents/${passport.agentId}`}
              className="shrink-0 text-[12px] font-medium text-[--accent] transition-colors hover:text-[--accent-hover]"
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
      <dt className="text-[10px] font-medium uppercase tracking-widest text-[--text-tertiary]">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
