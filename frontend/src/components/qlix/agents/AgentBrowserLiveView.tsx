"use client";

import { Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type BrowserFrame = {
  id: string;
  tool: string;
  label: string;
  mime: string;
  imageBase64: string;
};

type Props = {
  readonly frames: BrowserFrame[];
  readonly active?: boolean;
  readonly className?: string;
  readonly compact?: boolean;
  readonly actionHint?: string | null;
  readonly onImageClick?: (frame: BrowserFrame) => void;
};

export function AgentBrowserLiveView({
  frames,
  active = false,
  className,
  compact = false,
  actionHint,
  onImageClick,
}: Props) {
  const latest = frames.length > 0 ? frames[frames.length - 1] : null;
  const dataUrl = latest
    ? `data:${latest.mime || "image/png"};base64,${latest.imageBase64}`
    : null;

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-[--border-subtle] bg-black/30",
        compact ? "border-b" : "border-l",
        className,
      )}
      aria-label="Live browser view"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[--border-subtle] px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[--text-tertiary]">
          <Globe className="size-3.5 text-sky-500" aria-hidden />
          Browser
        </div>
        {active ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-600 dark:text-sky-300">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Live
          </span>
        ) : null}
      </div>

      {(actionHint || (active && latest?.label)) && (
        <p className="border-b border-[--border-subtle] px-3 py-1.5 text-[10px] leading-snug text-[--text-secondary]">
          {actionHint ?? latest?.label}
        </p>
      )}

      <div className={cn("relative flex-1 overflow-hidden bg-[#0a0a0c]", compact ? "aspect-video max-h-48" : "min-h-[200px]")}>
        {dataUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dataUrl}
              alt={latest?.label ?? "Browser screenshot"}
              className={cn("h-full w-full object-contain object-top", onImageClick && latest && "cursor-pointer hover:opacity-90 transition-opacity")}
              onClick={() => onImageClick?.(latest!)}
            />
            {latest?.label ? (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2.5 pb-2 pt-8">
                <p className="text-[11px] font-medium text-white/95">{latest.label}</p>
                <p className="font-mono text-[9px] text-white/50">{latest.tool}</p>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 px-4 text-center text-[11px] text-[--text-tertiary]">
            {active ? (
              <>
                <Loader2 className="size-5 animate-spin text-sky-500/80" aria-hidden />
                <p>Waiting for first browser action…</p>
              </>
            ) : (
              <p>No browser frames yet.</p>
            )}
          </div>
        )}
      </div>

      {frames.length > 1 && !compact ? (
        <div className="flex gap-1 overflow-x-auto border-t border-[--border-subtle] p-2 [scrollbar-width:thin]">
          {frames.map((f) => (
            <button
              key={f.id}
              type="button"
              className="relative h-12 w-20 shrink-0 overflow-hidden rounded border border-[--border-subtle] ring-offset-1 hover:ring-2 hover:ring-sky-500/40"
              title={f.label}
              onClick={() => {
                const el = document.getElementById(`browser-frame-${f.id}`);
                el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${f.mime || "image/png"};base64,${f.imageBase64}`}
                alt=""
                className="h-full w-full object-cover object-top"
              />
            </button>
          ))}
        </div>
      ) : null}

      <p className="border-t border-[--border-subtle] px-3 py-1.5 text-[9px] leading-snug text-[--text-tertiary]">
        Live snapshots from your agent's browser — captured after each step, not a continuous video.
      </p>
    </aside>
  );
}
