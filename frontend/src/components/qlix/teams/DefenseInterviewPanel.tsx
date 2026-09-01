"use client";

import { useState } from "react";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import type { DefenseInterviewState } from "@/lib/teams-api";
import { cn } from "@/lib/utils/cn";

interface DefenseInterviewPanelProps {
  state: DefenseInterviewState | null;
  preparing: boolean;
  loading: boolean;
  submittingThreadId: string | null;
  error: string | null;
  onAnswer: (threadId: string, text: string) => Promise<void>;
}

export function DefenseInterviewPanel({
  state,
  preparing,
  loading,
  submittingThreadId,
  error,
  onAnswer,
}: DefenseInterviewPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const threads = state?.threads ?? [];
  const openCount = threads.filter((thread) => thread.status === "waiting_input").length;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50/90 to-white shadow-sm"
      aria-label="Defense interview"
      data-testid="defense-interview-panel"
    >
      <div className="flex items-center gap-3 border-b border-violet-100 px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-violet-600 text-white">
          <ShieldCheck size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-black">Defense interview</h2>
          <p className="text-[11.5px] text-black/55">
            {openCount > 0
              ? `${openCount} question${openCount === 1 ? "" : "s"} waiting for your answer`
              : state?.active
                ? "Your answers are being recorded…"
                : threads.length > 0
                  ? "Interview complete · the examiner team is continuing"
                  : "The interviewer is preparing evidence-based questions"}
          </p>
        </div>
        {(loading || preparing || state?.active) && <Loader2 size={14} className="animate-spin text-violet-500" />}
      </div>

      <div className="flex flex-col gap-4 p-4">
        {threads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-violet-200 bg-[#E2F0CC]/70 px-4 py-5 text-center text-[12px] text-black/50">
            The Defense Interviewer is reviewing the findings. Questions will appear here automatically.
          </div>
        ) : null}

        {threads.map((thread, index) => {
          const waiting = thread.status === "waiting_input";
          const value = drafts[thread.threadId] ?? "";
          const submitting = submittingThreadId === thread.threadId;
          return (
            <div key={thread.threadId} className="flex flex-col gap-2.5">
              <div className="max-w-[88%] self-start rounded-2xl rounded-tl-md bg-[#E2F0CC] px-3.5 py-3 shadow-sm ring-1 ring-black/[0.06]">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-violet-600">
                  Question {index + 1}{thread.criterionId ? ` · ${thread.criterionId}` : ""}
                </p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-black/85">{thread.questionText}</p>
              </div>

              {thread.answerText && !waiting ? (
                <div className="max-w-[88%] self-end rounded-2xl rounded-tr-md bg-black px-3.5 py-3 text-[13px] leading-relaxed text-white">
                  {thread.answerText}
                </div>
              ) : waiting ? (
                <div className="ml-auto flex w-[92%] flex-col gap-2">
                  <textarea
                    value={value}
                    onChange={(event) => setDrafts((current) => ({ ...current, [thread.threadId]: event.target.value }))}
                    placeholder="Explain your reasoning and refer to the relevant code or command…"
                    rows={3}
                    disabled={submitting}
                    className="w-full resize-y rounded-xl border border-black/10 bg-[#E2F0CC] px-3 py-2.5 text-[13px] leading-relaxed text-black outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={!value.trim() || submitting}
                    onClick={() => void onAnswer(thread.threadId, value.trim())}
                    className={cn(
                      "inline-flex h-8 items-center justify-center gap-1.5 self-end rounded-lg bg-violet-600 px-3 text-[11.5px] font-medium text-white transition hover:bg-violet-700",
                      "disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    {submitting ? "Sending…" : "Send answer"}
                  </button>
                </div>
              ) : (
                <p className="self-end text-[11px] text-black/45">Answer is being processed…</p>
              )}
            </div>
          );
        })}

        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[11.5px] text-red-700">{error}</p> : null}
      </div>
    </section>
  );
}
