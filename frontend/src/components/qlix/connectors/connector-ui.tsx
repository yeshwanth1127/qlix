"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Info, Sparkles } from "lucide-react";
import { SketchBox } from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";

/* ── Status dot ──────────────────────────────────────────────────────────── */

export type ConnectorStatus = "connected" | "pending" | "idle" | "error";

const STATUS_LABEL: Record<ConnectorStatus, string> = {
  connected: "Connected",
  pending: "Waiting",
  idle: "Not connected",
  error: "Needs attention",
};

/** Single ink dot — the only status ornament a row needs. */
export function ConnectorStatusDot({
  status,
  label,
}: {
  readonly status: ConnectorStatus;
  readonly label?: string;
}) {
  const text = label ?? STATUS_LABEL[status];
  return (
    <>
      <span className={cn("connector-dot", `connector-dot--${status}`)} title={text} aria-hidden />
      <span className="sr-only">{text}</span>
    </>
  );
}

/* ── Section heading ─────────────────────────────────────────────────────── */

export function SectionHeading({
  title,
  hint,
  right,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-black">{title}</h2>
        {hint ? <p className="connector-meta">{hint}</p> : null}
      </div>
      {right}
    </div>
  );
}

/* ── Panel ───────────────────────────────────────────────────────────────── */

/** One glass surface that hosts a stack of connector rows. */
export function ConnectorPanel({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <SketchBox className={cn("connector-panel overflow-hidden", className)}>{children}</SketchBox>;
}

/* ── Row ─────────────────────────────────────────────────────────────────── */

interface ConnectorRowProps {
  readonly id?: string;
  readonly icon: ReactNode;
  readonly name: string;
  /** One short line: the account when linked, otherwise what it unlocks. */
  readonly meta?: ReactNode;
  readonly status?: ConnectorStatus;
  readonly statusLabel?: string;
  readonly action?: ReactNode;
  readonly highlight?: boolean;
  readonly expandable?: boolean;
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
  readonly children?: ReactNode;
}

export function ConnectorRow({
  id,
  icon,
  name,
  meta,
  status,
  statusLabel,
  action,
  highlight = false,
  expandable = false,
  expanded = false,
  onToggle,
  children,
}: ConnectorRowProps) {
  return (
    <div
      id={id}
      className={cn(
        "connector-row",
        highlight && "connector-row--highlight",
        expanded && "connector-row--open",
      )}
    >
      <div className="flex items-center gap-3.5 px-4 py-4 sm:gap-4 sm:px-5">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold tracking-[-0.005em] text-black">
              {name}
            </h3>
            {status ? <ConnectorStatusDot status={status} label={statusLabel} /> : null}
          </div>
          {meta ? <p className="connector-meta mt-0.5 truncate">{meta}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {action}
          {expandable ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? `Hide ${name} settings` : `Show ${name} settings`}
              className="connector-chevron"
            >
              <ChevronDown size={15} />
            </button>
          ) : null}
        </div>
      </div>

      {expandable ? (
        <div className={cn("connector-detail", expanded && "connector-detail--open")}>
          <div className="min-h-0 overflow-hidden">
            <div className="connector-detail-inner px-4 pb-5 pt-4 sm:px-5">{children}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Alerts ──────────────────────────────────────────────────────────────── */

type ConnectorAlertVariant = "success" | "error" | "info" | "warning";

const ALERT_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: Sparkles,
} as const;

export function ConnectorAlert({
  variant,
  children,
  className,
}: {
  readonly variant: ConnectorAlertVariant;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const Icon = ALERT_ICONS[variant];
  return (
    <div className={cn("connector-alert sketch-rise", `connector-alert--${variant}`, className)}>
      <Icon size={14} className="connector-alert-icon mt-px shrink-0" aria-hidden />
      <p className="text-[12.5px] leading-relaxed text-black">{children}</p>
    </div>
  );
}

/* ── Header summary ──────────────────────────────────────────────────────── */

/** Quiet level indicator replacing the old oversized stat tiles. */
export function ConnectorsSummary({
  connected,
  total,
  loading = false,
}: {
  readonly connected: number;
  readonly total: number;
  readonly loading?: boolean;
}) {
  return (
    <span className="connector-summary">
      <span className="flex items-center gap-[3px]" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn("connector-summary-bar", !loading && i < connected && "is-on")}
          />
        ))}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-black">
        {loading ? "Checking" : `${connected} of ${total} connected`}
      </span>
    </span>
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
      className={cn("connector-chip", active && "connector-chip--active", disabled && "opacity-35")}
    >
      {label}
      {count !== undefined ? <span className="ml-1.5 tabular-nums opacity-55">{count}</span> : null}
    </button>
  );
}
