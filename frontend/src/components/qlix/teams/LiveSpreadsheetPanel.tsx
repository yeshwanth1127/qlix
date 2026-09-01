"use client";

import { Download, ExternalLink, Table2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { LiveArtifactPreview } from "@/components/qlix/teams/liveArtifactState";

const HAIRLINE = "border-black/10";
const INK_SOFT = "text-black/55";

function formatCell(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return value;
}

interface LiveSpreadsheetPanelProps {
  readonly sheet: LiveArtifactPreview;
  readonly isLive: boolean;
  readonly onClose?: () => void;
  readonly className?: string;
}

export function LiveSpreadsheetPanel({
  sheet,
  isLive,
  onClose,
  className,
}: LiveSpreadsheetPanelProps) {
  const displayColumns =
    sheet.columns.length > 0
      ? sheet.columns.filter((column) => !column.startsWith('_'))
      : sheet.rows.length > 0
        ? Object.keys(sheet.rows[0] ?? {}).filter((key) => !key.startsWith('_'))
        : [];

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-l bg-[#fafafa]",
        HAIRLINE,
        className,
      )}
      aria-label="Live spreadsheet"
    >
      <div className={cn("flex shrink-0 items-center gap-2 border-b px-3 py-2.5", HAIRLINE)}>
        <Table2 size={14} className="shrink-0 text-[#217346]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-black">{sheet.fileName}</p>
          <p className={cn("truncate text-[10.5px]", INK_SOFT)}>
            {sheet.rowCount} row{sheet.rowCount === 1 ? "" : "s"}
            {isLive ? " · updating live" : ""}
          </p>
        </div>
        {isLive ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#217346]/25 bg-[#217346]/10 px-2 py-0.5 text-[10px] font-medium text-[#217346]">
            <span className="size-1.5 animate-pulse rounded-full bg-[#217346]" aria-hidden />
            Live
          </span>
        ) : null}
        {sheet.url ? (
          <a
            href={sheet.url}
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
            aria-label="Close spreadsheet"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {displayColumns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <Table2 size={28} className="text-black/20" aria-hidden />
            <p className="text-[13px] font-medium text-black/70">Sheet ready</p>
            <p className={cn("max-w-xs text-[12px] leading-relaxed", INK_SOFT)}>
              {isLive
                ? "Rows will appear here as WhatsApp replies come in."
                : "No rows were captured in this run."}
            </p>
          </div>
        ) : (
          <table className="w-full min-w-max border-collapse text-left text-[12px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#217346] text-white">
                {displayColumns.map((column) => (
                  <th
                    key={column}
                    className="border border-[#1a5c38] px-3 py-2 font-medium whitespace-nowrap"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={displayColumns.length}
                    className={cn("border border-black/10 bg-[#E2F0CC] px-3 py-8 text-center", INK_SOFT)}
                  >
                    {isLive ? "Waiting for the first reply…" : "No rows yet"}
                  </td>
                </tr>
              ) : (
                sheet.rows.map((row, rowIndex) => (
                  <tr
                    key={`${rowIndex}-${String(row.contact_jid ?? rowIndex)}`}
                    className={rowIndex % 2 === 0 ? "bg-[#E2F0CC]" : "bg-[#f3f3f3]"}
                  >
                    {displayColumns.map((column) => (
                      <td
                        key={column}
                        className="max-w-[220px] truncate border border-black/10 px-3 py-1.5 text-black/85"
                        title={formatCell(row[column])}
                      >
                        {formatCell(row[column])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {sheet.url ? (
        <div className={cn("shrink-0 border-t px-3 py-2", HAIRLINE)}>
          <a
            href={sheet.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#217346] hover:underline"
          >
            <Download size={12} aria-hidden />
            Download .xlsx
          </a>
        </div>
      ) : null}
    </aside>
  );
}
