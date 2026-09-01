"use client";

import { useEffect, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Info, Sparkles, X } from "lucide-react";
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

/* ── Tabs ────────────────────────────────────────────────────────────────── */

export function ConnectorTabs<T extends string>({
  value,
  onChange,
  items,
}: {
  readonly value: T;
  readonly onChange: (id: T) => void;
  readonly items: ReadonlyArray<{ id: T; label: string }>;
}) {
  return (
    <div className="connector-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={cn("connector-tab", value === item.id && "connector-tab--active")}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ── Card (board) ────────────────────────────────────────────────────────── */

export function ConnectorCard({
  id,
  icon,
  name,
  meta,
  status,
  highlight = false,
  onClick,
}: {
  readonly id?: string;
  readonly icon: ReactNode;
  readonly name: string;
  readonly meta?: ReactNode;
  readonly status?: ConnectorStatus;
  readonly highlight?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={cn(
        "connector-card group",
        status === "connected" && "connector-card--on",
        status === "pending" && "connector-card--pending",
        highlight && "connector-card--highlight",
      )}
    >
      <span className="connector-card-top">
        {icon}
        {status ? <ConnectorStatusDot status={status} /> : <span className="sketch-skeleton size-1.5 rounded-full" />}
      </span>
      <span className="connector-card-name">{name}</span>
      {meta ? <span className="connector-card-meta">{meta}</span> : null}
    </button>
  );
}

export function ConnectorCardSkeleton() {
  return (
    <div className="connector-card connector-card--skeleton" aria-hidden>
      <span className="sketch-skeleton size-10 rounded-lg" />
      <span className="sketch-skeleton mt-3 h-3 w-20 rounded-full" />
      <span className="sketch-skeleton mt-1.5 h-2.5 w-28 rounded-full" />
    </div>
  );
}

/* ── Detail sheet ────────────────────────────────────────────────────────── */

export function ConnectorSheet({
  open,
  onClose,
  icon,
  title,
  meta,
  action,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly icon?: ReactNode;
  readonly title: string;
  readonly meta?: ReactNode;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="connector-sheet-backdrop qlix-backdrop-in"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="connector-sheet qlix-scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="connector-sheet-head">
          <div className="flex min-w-0 items-center gap-3">
            {icon}
            <div className="min-w-0">
              <h2 id="connector-sheet-title" className="truncate text-[15px] font-medium tracking-[-0.015em] text-black">
                {title}
              </h2>
              {meta ? <p className="connector-meta mt-0.5 truncate">{meta}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {action}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="connector-sheet-close"
            >
              <X size={15} />
            </button>
          </div>
        </header>
        {children ? <div className="connector-sheet-body">{children}</div> : null}
      </div>
    </div>
  );
}
