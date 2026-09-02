"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export const PANEL_BORDER = "border-black/[0.08]";
export const PANEL_MUTED = "text-black/50";

export function LiveBadge({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-600/20 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800",
        className,
      )}
    >
      <span className="relative flex size-1.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/50" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-600" />
      </span>
      Live
    </span>
  );
}

export function PanelChrome({
  icon: Icon,
  iconClassName,
  title,
  subtitle,
  isLive,
  onClose,
  actions,
  children,
  className,
  bodyClassName,
}: {
  readonly icon: React.ComponentType<{ size?: number; className?: string }>;
  readonly iconClassName?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly isLive?: boolean;
  readonly onClose?: () => void;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}) {
  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-l bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.04)]",
        PANEL_BORDER,
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 border-b bg-gradient-to-b from-[#f7faf4] to-white px-4 py-3",
          PANEL_BORDER,
        )}
      >
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl border bg-white shadow-sm",
            PANEL_BORDER,
          )}
        >
          <Icon size={16} className={cn("text-[#5a8f2e]", iconClassName)} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold tracking-tight text-black">{title}</p>
          {subtitle ? (
            <p className={cn("truncate text-[11px]", PANEL_MUTED)}>{subtitle}</p>
          ) : null}
        </div>
        {isLive ? <LiveBadge /> : null}
        {actions}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex shrink-0 rounded-lg p-1.5 text-black/40 transition-colors hover:bg-black/[0.05] hover:text-black"
            aria-label="Close panel"
          >
            <X size={15} />
          </button>
        ) : null}
      </div>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </aside>
  );
}
