"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Clock,
  MessageCircle,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type {
  TeamRunConversationEvent,
  TeamRunConversationThread,
} from "@/lib/teams-api";
import {
  PANEL_MUTED,
  PanelChrome,
} from "@/components/qlix/teams/teamRunPanelChrome";

function statusMeta(status: string): { label: string; className: string } {
  switch (status) {
    case "waiting_input":
      return {
        label: "Awaiting reply",
        className: "border-amber-200/80 bg-amber-50 text-amber-900",
      };
    case "completed":
      return {
        label: "Complete",
        className: "border-emerald-200/80 bg-emerald-50 text-emerald-900",
      };
    case "failed":
      return {
        label: "Failed",
        className: "border-red-200/80 bg-red-50 text-red-800",
      };
    case "cancelled":
      return {
        label: "Closed",
        className: "border-black/10 bg-black/[0.03] text-black/55",
      };
    default:
      return {
        label: status.replace(/_/g, " "),
        className: "border-black/10 bg-black/[0.03] text-black/60",
      };
  }
}

function snippet(text: string | null | undefined, max = 96): string | null {
  const value = text?.trim() ?? "";
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function eventSnippet(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const row = payload as Record<string, unknown>;
  if (typeof row.text === "string" && row.text.trim()) return row.text;
  if (typeof row.content === "string" && row.content.trim()) return row.content;
  const inbound = row.inbound;
  if (inbound && typeof inbound === "object") {
    const text = (inbound as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) return text;
  }
  return "";
}

function contactLabel(thread: TeamRunConversationThread): string {
  const name = thread.participant?.displayName?.trim();
  const address = thread.participant?.address?.trim();
  if (name && address) return name;
  if (name) return name;
  if (address) return address.split("@")[0] ?? address;
  return "Contact";
}

function contactPhone(thread: TeamRunConversationThread): string | null {
  const address = thread.participant?.address?.trim();
  if (!address) return null;
  const digits = address.replace(/@.+$/, "").replace(/\D/g, "");
  if (!digits) return address;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return (name.trim().charAt(0) || "?").toUpperCase();
}

function MessagePreview({
  direction,
  text,
}: {
  readonly direction: "out" | "in";
  readonly text: string | null;
}) {
  const Icon = direction === "out" ? ArrowUpRight : ArrowDownLeft;
  const label = direction === "out" ? "Sent" : "Received";
  return (
    <div
      className={cn(
        "flex gap-2 rounded-xl border px-2.5 py-2",
        direction === "out"
          ? "border-[#8BC53D]/20 bg-[#f4f9ec]"
          : "border-black/[0.06] bg-[#fafafa]",
      )}
    >
      <Icon
        size={12}
        className={cn(
          "mt-0.5 shrink-0",
          direction === "out" ? "text-[#6b9e2f]" : "text-black/35",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-black/40">{label}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-black/80">
          {text ?? <span className="text-black/35">Nothing yet</span>}
        </p>
      </div>
    </div>
  );
}

interface ConversationThreadsPanelProps {
  readonly threads: TeamRunConversationThread[];
  readonly expandedThreadId: string | null;
  readonly eventsByThread: Record<string, TeamRunConversationEvent[]>;
  readonly loadingThreadId: string | null;
  readonly isLive: boolean;
  readonly onToggleThread: (threadId: string) => void;
  readonly onClose?: () => void;
  readonly className?: string;
}

export function ConversationThreadsPanel({
  threads,
  expandedThreadId,
  eventsByThread,
  loadingThreadId,
  isLive,
  onToggleThread,
  onClose,
  className,
}: ConversationThreadsPanelProps) {
  const waitingCount = threads.filter((t) => t.status === "waiting_input").length;

  return (
    <PanelChrome
      icon={MessageCircle}
      title="Conversations"
      subtitle={
        threads.length === 0
          ? "Per-lead WhatsApp threads"
          : `${threads.length} lead${threads.length === 1 ? "" : "s"} · ${waitingCount} waiting`
      }
      isLive={isLive}
      onClose={onClose}
      className={className}
      bodyClassName="overflow-y-auto bg-[#fbfbfa]"
    >
      {threads.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-2xl border border-black/[0.06] bg-white shadow-sm">
            <MessageCircle size={22} className="text-black/20" aria-hidden />
          </span>
          <p className="text-[13px] font-medium text-black/75">No threads yet</p>
          <p className={cn("max-w-[220px] text-[12px] leading-relaxed", PANEL_MUTED)}>
            Conversation threads appear here once outreach starts and contacts are messaged.
          </p>
        </div>
      ) : (
        <ul className="space-y-3 p-3">
          {threads.map((thread) => {
            const expanded = expandedThreadId === thread.id;
            const events = eventsByThread[thread.id] ?? [];
            const status = statusMeta(thread.status);
            const name = contactLabel(thread);
            const phone = contactPhone(thread);

            return (
              <li
                key={thread.id}
                className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
              >
                <button
                  type="button"
                  onClick={() => onToggleThread(thread.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-black/[0.015]"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#8BC53D]/25 to-[#6b9e2f]/15 text-[13px] font-semibold text-[#3d5c1f]">
                    {initials(name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-black">
                          {name}
                        </span>
                        {phone ? (
                          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-black/45">
                            <Phone size={10} aria-hidden />
                            {phone}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                            status.className,
                          )}
                        >
                          {status.label}
                        </span>
                        <ChevronDown
                          size={14}
                          className={cn(
                            "text-black/30 transition-transform",
                            expanded ? "rotate-0" : "-rotate-90",
                          )}
                          aria-hidden
                        />
                      </span>
                    </span>
                    <span className="mt-2.5 grid gap-2">
                      <MessagePreview
                        direction="out"
                        text={snippet(thread.lastOutbound?.text)}
                      />
                      <MessagePreview
                        direction="in"
                        text={snippet(thread.lastInbound?.text)}
                      />
                    </span>
                  </span>
                </button>

                {expanded ? (
                  <div className="border-t border-black/[0.06] bg-[#fafaf9] px-3 py-3">
                    {loadingThreadId === thread.id && events.length === 0 ? (
                      <p className={cn("text-center text-[11px] py-2", PANEL_MUTED)}>
                        Loading timeline…
                      </p>
                    ) : events.length === 0 ? (
                      <p className={cn("text-center text-[11px] py-2", PANEL_MUTED)}>
                        No events recorded yet.
                      </p>
                    ) : (
                      <ol className="relative space-y-0 pl-1">
                        <span
                          className="absolute bottom-2 left-[7px] top-2 w-px bg-black/10"
                          aria-hidden
                        />
                        {events.map((event) => {
                          const text = snippet(eventSnippet(event.payload), 160);
                          const inbound =
                            event.direction === "inbound" ||
                            event.eventType === "inbound_received";
                          return (
                            <li key={event.id} className="relative flex gap-3 pb-3 last:pb-0">
                              <span
                                className={cn(
                                  "relative z-[1] mt-1.5 size-3.5 shrink-0 rounded-full border-2 border-white",
                                  inbound ? "bg-emerald-500" : "bg-[#8BC53D]",
                                )}
                                aria-hidden
                              />
                              <div className="min-w-0 flex-1 rounded-xl border border-black/[0.06] bg-white px-2.5 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-black/40">
                                  {inbound ? "Inbound" : "Outbound"}
                                  <span className="mx-1 font-normal normal-case">·</span>
                                  <span className="font-normal normal-case text-black/55">
                                    {event.eventType.replace(/_/g, " ")}
                                  </span>
                                </p>
                                {text ? (
                                  <p className="mt-1 text-[11.5px] leading-snug text-black/80">
                                    {text}
                                  </p>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {isLive && threads.length > 0 ? (
        <div className="sticky bottom-0 border-t border-black/[0.06] bg-white/95 px-4 py-2.5 backdrop-blur-sm">
          <p className="flex items-center justify-center gap-2 text-[11px] text-black/50">
            <Clock size={11} aria-hidden />
            Polls advance when each contact replies
          </p>
        </div>
      ) : null}
    </PanelChrome>
  );
}
