"use client";

import type { ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info, Sparkles } from "lucide-react";
import { SketchBox } from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";
import type { SketchTone } from "@/components/qlix/sketch/tokens";

/* ── Animated connector card wrapper ─────────────────────────────────────── */

interface ConnectorCardProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly tone?: SketchTone;
  readonly connected?: boolean;
  readonly highlight?: boolean;
  readonly staggerIndex?: number;
}

export function ConnectorCard({
  children,
  className,
  tone = "default",
  connected = false,
  highlight = false,
  staggerIndex = 0,
}: ConnectorCardProps) {
  return (
    <div
      className={cn(
        "connector-card-wrap",
        connected && "connector-card-wrap--connected",
        highlight && !connected && "connector-card-wrap--highlight",
      )}
      style={{ animationDelay: `${staggerIndex * 60}ms` }}
    >
      <SketchBox
        tone={connected ? "green" : highlight ? "amber" : tone}
        className={cn(
          "connector-card-inner sketch-card-hover sketch-rise overflow-hidden",
          className,
        )}
      >
        {children}
      </SketchBox>
    </div>
  );
}

/* ── Status badge ────────────────────────────────────────────────────────── */

type ConnectorStatus = "connected" | "pending" | "idle";

interface ConnectorStatusBadgeProps {
  readonly status: ConnectorStatus;
  readonly label?: string;
}

export function ConnectorStatusBadge({ status, label }: ConnectorStatusBadgeProps) {
  const labels: Record<ConnectorStatus, string> = {
    connected: "Connected",
    pending: "Pending",
    idle: "Not connected",
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "connector-status-dot",
          status === "connected" && "connector-status-dot--connected",
          status === "pending" && "connector-status-dot--pending",
          status === "idle" && "connector-status-dot--idle",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "font-serif text-[10px] uppercase tracking-[0.14em]",
          status === "connected" && "text-[color:var(--sketch-green,#15803d)]",
          status === "pending" && "text-[#b45309]",
          status === "idle" && "text-black/45",
        )}
      >
        {label ?? labels[status]}
      </span>
    </span>
  );
}

/* ── Alert banners ───────────────────────────────────────────────────────── */

type ConnectorAlertVariant = "success" | "error" | "info" | "warning";

interface ConnectorAlertProps {
  readonly variant: ConnectorAlertVariant;
  readonly children: ReactNode;
  readonly className?: string;
}

const ALERT_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: Sparkles,
} as const;

const ALERT_TONES: Record<ConnectorAlertVariant, SketchTone> = {
  success: "green",
  error: "rose",
  info: "blue",
  warning: "amber",
};

export function ConnectorAlert({ variant, children, className }: ConnectorAlertProps) {
  const Icon = ALERT_ICONS[variant];
  return (
    <SketchBox
      tone={ALERT_TONES[variant]}
      className={cn("sketch-rise flex items-start gap-2.5 px-3.5 py-2.5", className)}
    >
      <Icon size={15} className="mt-0.5 shrink-0 text-black/70" aria-hidden />
      <p className="text-[13px] leading-relaxed text-black">{children}</p>
    </SketchBox>
  );
}

/* ── Stats strip ─────────────────────────────────────────────────────────── */

interface ConnectorsStatsStripProps {
  readonly connectedCount: number;
  readonly totalLive: number;
  readonly catalogCount: number;
  readonly loading?: boolean;
}

export function ConnectorsStatsStrip({
  connectedCount,
  totalLive,
  catalogCount,
  loading = false,
}: ConnectorsStatsStripProps) {
  const stats = [
    { value: loading ? "—" : connectedCount, label: "Connected", tone: "green" as SketchTone },
    { value: loading ? "—" : totalLive, label: "Live now", tone: "purple" as SketchTone },
    { value: catalogCount, label: "In catalog", tone: "blue" as SketchTone },
  ];

  return (
    <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
      {stats.map((s, i) => (
        <div key={s.label} className="sketch-rise" style={{ animationDelay: `${i * 50}ms` }}>
          <SketchBox
            tone={s.tone}
            className="sketch-card-hover flex flex-col items-center px-3 py-4 sm:px-4 sm:py-5"
          >
          <span
            className="text-[28px] font-light leading-none tabular-nums sm:text-[36px]"
            style={{ WebkitTextStroke: "1px #0e0d12", color: "transparent" }}
            aria-hidden
          >
            {s.value}
          </span>
          <span className="sr-only">{s.value}</span>
          <span className="mt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-black">
            {s.label}
          </span>
        </SketchBox>
        </div>
      ))}
    </div>
  );
}

/* ── Filter chip (catalog) ───────────────────────────────────────────────── */

interface ConnectorFilterChipProps {
  readonly label: string;
  readonly count?: number;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

export function ConnectorFilterChip({
  label,
  count,
  active = false,
  disabled = false,
  onClick,
}: ConnectorFilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "connector-filter-chip rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.08em]",
        active && "connector-filter-chip--active",
        !active && "text-black",
        disabled && "opacity-40",
      )}
    >
      {label}
      {count !== undefined ? (
        <span className={cn("ml-1.5 tabular-nums", active ? "text-white/75" : "text-black/55")}>
          {count}
        </span>
      ) : null}
    </button>
  );
}
