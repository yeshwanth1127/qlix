"use client";

import { Download, ExternalLink, FileText, Presentation, Table2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { LiveSpreadsheetPanel } from "@/components/qlix/teams/LiveSpreadsheetPanel";
import type { LiveArtifactPreview } from "@/components/qlix/teams/liveArtifactState";

const HAIRLINE = "border-black/10";
const INK_SOFT = "text-black/55";

function inlineUrl(url: string): string {
  return url.includes("?") ? `${url}&inline=1` : `${url}?inline=1`;
}

function officeEmbedUrl(url: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(inlineUrl(url))}`;
}

function formatIcon(previewKind: LiveArtifactPreview["previewKind"]) {
  switch (previewKind) {
    case "table":
      return Table2;
    case "office":
      return Presentation;
    default:
      return FileText;
  }
}

interface LiveArtifactPanelProps {
  readonly artifact: LiveArtifactPreview;
  readonly isLive: boolean;
  readonly onClose?: () => void;
  readonly className?: string;
}

export function LiveArtifactPanel({
  artifact,
  isLive,
  onClose,
  className,
}: LiveArtifactPanelProps) {
  if (artifact.previewKind === "table") {
    return (
      <LiveSpreadsheetPanel
        sheet={artifact}
        isLive={isLive}
        onClose={onClose}
        className={className}
      />
    );
  }

  const Icon = formatIcon(artifact.previewKind);
  const previewUrl = inlineUrl(artifact.url);

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-l bg-[#fafafa]",
        HAIRLINE,
        className,
      )}
      aria-label="Live document"
    >
      <div className={cn("flex shrink-0 items-center gap-2 border-b px-3 py-2.5", HAIRLINE)}>
        <Icon size={14} className="shrink-0 text-[#8BC53D]" aria-hidden />
        <div className="min-h-0 flex-1">
          <p className="truncate text-[13px] font-medium text-black">{artifact.fileName}</p>
          <p className={cn("truncate text-[10.5px]", INK_SOFT)}>
            {artifact.rowCount > 0
              ? `${artifact.rowCount} update${artifact.rowCount === 1 ? "" : "s"}`
              : "Live document"}
            {isLive ? " · updating live" : ""}
          </p>
        </div>
        {isLive ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#8BC53D]/25 bg-[#8BC53D]/10 px-2 py-0.5 text-[10px] font-medium text-[#8BC53D]">
            <span className="size-1.5 animate-pulse rounded-full bg-[#8BC53D]" aria-hidden />
            Live
          </span>
        ) : null}
        {artifact.url ? (
          <a
            href={artifact.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open file"
            className="inline-flex shrink-0 rounded-lg p-1.5 text-black/45 transition-colors hover:bg-black/5 hover:text-black"
          >
            <ExternalLink size={14} aria-hidden />
          </a>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex shrink-0 rounded-lg p-1.5 text-black/45 transition-colors hover:bg-black/5 hover:text-black lg:hidden"
            aria-label="Close document panel"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#E2F0CC]">
        {artifact.previewKind === "pdf" && artifact.url ? (
          <iframe
            title={artifact.fileName}
            src={previewUrl}
            className="h-full w-full border-0"
          />
        ) : null}

        {artifact.previewKind === "office" && artifact.url ? (
          <iframe
            title={artifact.fileName}
            src={officeEmbedUrl(artifact.url)}
            className="h-full w-full border-0"
          />
        ) : null}

        {(artifact.previewKind === "html" || artifact.previewKind === "markdown") && artifact.url ? (
          <iframe
            title={artifact.fileName}
            src={previewUrl}
            className="h-full w-full border-0"
            sandbox="allow-same-origin"
          />
        ) : null}

        {artifact.previewKind === "download" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <FileText size={32} className="text-black/20" aria-hidden />
            <p className="text-[13px] font-medium text-black/75">Live file ready</p>
            <p className={cn("max-w-xs text-[12px] leading-relaxed", INK_SOFT)}>
              Open or download the file to view it. It refreshes in place as replies arrive.
            </p>
          </div>
        )}
      </div>

      {artifact.url ? (
        <div className={cn("shrink-0 border-t px-3 py-2", HAIRLINE)}>
          <a
            href={artifact.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#8BC53D] hover:underline"
          >
            <Download size={12} aria-hidden />
            Download {artifact.fileName.split(".").pop()?.toUpperCase() ?? "file"}
          </a>
        </div>
      ) : null}
    </aside>
  );
}
