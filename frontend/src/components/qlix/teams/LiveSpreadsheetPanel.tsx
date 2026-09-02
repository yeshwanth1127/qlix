"use client";

import { Download, ExternalLink, Inbox, Table2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { LiveArtifactPreview } from "@/components/qlix/teams/liveArtifactState";
import {
  PANEL_BORDER,
  PANEL_MUTED,
  PanelChrome,
} from "@/components/qlix/teams/teamRunPanelChrome";

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
      ? sheet.columns.filter((column) => !column.startsWith("_"))
      : sheet.rows.length > 0
        ? Object.keys(sheet.rows[0] ?? {}).filter((key) => !key.startsWith("_"))
        : [];

  const headerActions =
    sheet.url != null ? (
      <a
        href={sheet.url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open file"
        className="inline-flex shrink-0 rounded-lg p-1.5 text-black/40 transition-colors hover:bg-black/[0.05] hover:text-black"
      >
        <ExternalLink size={15} aria-hidden />
      </a>
    ) : null;

  return (
    <PanelChrome
      icon={Table2}
      iconClassName="text-[#217346]"
      title={sheet.fileName}
      subtitle={
        sheet.rowCount > 0
          ? `${sheet.rowCount} response${sheet.rowCount === 1 ? "" : "s"} captured`
          : "Responses appear as replies arrive"
      }
      isLive={isLive}
      onClose={onClose}
      actions={headerActions}
      className={className}
      bodyClassName="flex min-h-0 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-[#fbfbfa]">
        {displayColumns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-2xl border border-[#217346]/15 bg-[#217346]/5">
              <Table2 size={22} className="text-[#217346]/60" aria-hidden />
            </span>
            <p className="text-[13px] font-medium text-black/75">Sheet ready</p>
            <p className={cn("max-w-[240px] text-[12px] leading-relaxed", PANEL_MUTED)}>
              {isLive
                ? "Columns will populate when the first WhatsApp reply is captured."
                : "No rows were captured in this run."}
            </p>
          </div>
        ) : (
          <div className="p-3">
            <div className="overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-sm">
              <table className="w-full min-w-max border-collapse text-left text-[12px]">
                <thead>
                  <tr className="bg-[#217346] text-white">
                    {displayColumns.map((column) => (
                      <th
                        key={column}
                        className="border-r border-[#1a5c38]/50 px-3 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap last:border-r-0"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.length === 0 ? (
                    <tr>
                      <td colSpan={displayColumns.length} className="px-3 py-12">
                        <div className="flex flex-col items-center gap-2 text-center">
                          <Inbox size={24} className="text-black/15" aria-hidden />
                          <p className="text-[13px] font-medium text-black/60">
                            {isLive ? "Waiting for the first reply…" : "No rows yet"}
                          </p>
                          <p className={cn("max-w-xs text-[11.5px]", PANEL_MUTED)}>
                            Each response adds a row here in real time.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sheet.rows.map((row, rowIndex) => (
                      <tr
                        key={`${rowIndex}-${String(row.contact_jid ?? rowIndex)}`}
                        className={cn(
                          "border-t border-black/[0.05] transition-colors hover:bg-[#f4f9ec]/60",
                          rowIndex % 2 === 0 ? "bg-white" : "bg-[#fafaf9]",
                        )}
                      >
                        {displayColumns.map((column) => (
                          <td
                            key={column}
                            className="max-w-[200px] truncate border-r border-black/[0.04] px-3 py-2 text-black/85 last:border-r-0"
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
            </div>
          </div>
        )}
      </div>

      {sheet.url ? (
        <div className={cn("shrink-0 border-t bg-white px-4 py-3", PANEL_BORDER)}>
          <a
            href={sheet.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#217346]/20 bg-[#217346]/5 px-3 py-2 text-[12px] font-medium text-[#217346] transition-colors hover:bg-[#217346]/10"
          >
            <Download size={14} aria-hidden />
            Download spreadsheet
          </a>
        </div>
      ) : null}
    </PanelChrome>
  );
}
