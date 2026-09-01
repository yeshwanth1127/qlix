"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Plus, X } from "lucide-react";
import {
  createSession,
  listSessions,
  type ChecklistItemDTO,
  type WorkSessionDTO,
} from "@/lib/assessment-api";
import { cn } from "@/lib/utils/cn";
import {
  SketchBox,
  SketchListSkeleton,
  SketchPageHeader,
  sketchButtonGhost,
  sketchButtonPrimary,
  sketchButtonSecondary,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import { formatSessionDate, statusLabel, statusTone } from "./assessmentUi";

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function splitWindow(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const [date, time = ""] = value.split("T");
  return { date, time: time.slice(0, 5) };
}

function joinWindow(date: string, time: string): string {
  if (!date) return "";
  return `${date}T${time || "00:00"}`;
}

function openNativePicker(event: { currentTarget: HTMLInputElement }) {
  const el = event.currentTarget;
  try {
    el.showPicker();
  } catch {
    /* already open, or the engine has no picker */
  }
}

const pickerInputClass = cn(
  sketchInput,
  "cursor-pointer [color-scheme:light] [&::-webkit-calendar-picker-indicator]:size-4 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100",
);

function DateTimeFields({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  const { date, time } = splitWindow(value);
  return (
    <div className="flex flex-col gap-2">
      <span className={cn(sketchLabel, "text-black/45")}>{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => onChange(joinWindow(e.target.value, time))}
          onClick={openNativePicker}
          className={pickerInputClass}
          aria-label={`${label} date`}
        />
        <input
          type="time"
          value={time}
          onChange={(e) => onChange(joinWindow(date || localToday(), e.target.value))}
          onClick={openNativePicker}
          className={pickerInputClass}
          aria-label={`${label} time`}
        />
      </div>
    </div>
  );
}

function TextListEditor({
  label,
  placeholder,
  items,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly items: string[];
  readonly onChange: (items: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={cn(sketchLabel, "text-black/45")}>{label}</span>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={item}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
            className={sketchInput}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className={cn(sketchButtonGhost, "size-10 shrink-0 px-0")}
            aria-label={`Remove ${label} row`}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className={cn(sketchButtonGhost, "w-fit px-3")}
      >
        <Plus className="size-3.5" aria-hidden />
        Add
      </button>
    </div>
  );
}

function StatusPill({ status }: { readonly status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-black/70",
        statusTone(status) === "green" && "bg-[color:var(--sketch-green-soft)]",
        statusTone(status) === "blue" && "bg-[color:var(--sketch-tint-blue)]",
        statusTone(status) === "amber" && "bg-[color:var(--sketch-tint-amber)]",
        statusTone(status) === "default" && "bg-black/[0.04]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "active" && "bg-[color:var(--sketch-green)]",
          status === "submitted" && "bg-[color:var(--sketch-purple)]",
          status === "closed" && "bg-black/30",
          !["active", "submitted", "closed"].includes(status) && "bg-[color:var(--sketch-purple)]",
        )}
      />
      {statusLabel(status)}
    </span>
  );
}

export function AssessmentSessionListView({
  routePrefix,
}: {
  readonly routePrefix: "/individual" | "/organization";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<WorkSessionDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showBrief, setShowBrief] = useState(false);

  const [subjectRef, setSubjectRef] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [expectedStackText, setExpectedStackText] = useState("");
  const [windowStartsAt, setWindowStartsAt] = useState("");
  const [windowEndsAt, setWindowEndsAt] = useState("");
  const [aiUsagePolicy, setAiUsagePolicy] = useState("");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [requiredDeliverables, setRequiredDeliverables] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    const rows = await listSessions();
    if (!rows) {
      setError("Could not load assessments.");
      setSessions([]);
    } else {
      setSessions(rows);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function resetForm() {
    setSubjectRef("");
    setProjectDescription("");
    setExpectedStackText("");
    setWindowStartsAt("");
    setWindowEndsAt("");
    setAiUsagePolicy("");
    setChecklist([]);
    setRequiredDeliverables([]);
    setShowBrief(false);
    setShowForm(false);
  }

  async function onCreate() {
    if (!subjectRef.trim()) return;
    setCreating(true);
    setError(null);
    const checklistItems: ChecklistItemDTO[] = checklist
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, i) => ({ id: `c${i}`, text }));
    const session = await createSession({
      subjectRef: subjectRef.trim(),
      projectDescription: projectDescription.trim() || undefined,
      expectedStack: expectedStackText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      windowStartsAt: windowStartsAt ? new Date(windowStartsAt).toISOString() : undefined,
      windowEndsAt: windowEndsAt ? new Date(windowEndsAt).toISOString() : undefined,
      aiUsagePolicy: aiUsagePolicy.trim() || undefined,
      checklist: checklistItems,
      requiredDeliverables: requiredDeliverables.map((s) => s.trim()).filter(Boolean),
    });
    setCreating(false);
    if (!session) {
      setError("Could not create the assessment.");
      return;
    }
    resetForm();
    router.push(`${routePrefix}/assessments/${session.id}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader
        title="Assessments"
        subtitle="Observe real work. Evaluate against a brief. Review with evidence."
        actions={
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className={showForm ? sketchButtonGhost : sketchButtonPrimary}
          >
            {showForm ? (
              "Cancel"
            ) : (
              <>
                <Plus className="size-3.5" aria-hidden />
                New assessment
              </>
            )}
          </button>
        }
      />

      {showForm && (
        <SketchBox className="mb-8 p-6 sm:p-8" tone="white">
          <div className="mb-6">
            <p className={cn(sketchLabel, "text-black/40")}>New session</p>
            <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-black/70">
              Name the candidate, then optionally set the brief the evaluator will judge against.
            </p>
          </div>

          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-2">
              <span className={cn(sketchLabel, "text-black/45")}>Candidate</span>
              <input
                type="text"
                value={subjectRef}
                onChange={(e) => setSubjectRef(e.target.value)}
                placeholder="Name or identifier"
                className={sketchInput}
                autoFocus
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBrief((v) => !v)}
                className={sketchButtonGhost}
              >
                {showBrief ? "Hide brief" : "Add brief"}
              </button>
              <button
                type="button"
                disabled={creating || !subjectRef.trim()}
                onClick={() => void onCreate()}
                className={sketchButtonPrimary}
              >
                {creating ? "Creating…" : "Create session"}
              </button>
            </div>

            {showBrief && (
              <div className="flex flex-col gap-6 border-t border-black/[0.06] pt-6">
                <label className="flex flex-col gap-2">
                  <span className={cn(sketchLabel, "text-black/45")}>Project description</span>
                  <textarea
                    value={projectDescription}
                    onChange={(e) => setProjectDescription(e.target.value)}
                    placeholder="What should they build?"
                    rows={4}
                    className={cn(sketchInput, "min-h-[6.5rem] resize-y")}
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className={cn(sketchLabel, "text-black/45")}>Expected stack</span>
                  <input
                    type="text"
                    value={expectedStackText}
                    onChange={(e) => setExpectedStackText(e.target.value)}
                    placeholder="React, Postgres, Express"
                    className={sketchInput}
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <DateTimeFields label="Window starts" value={windowStartsAt} onChange={setWindowStartsAt} />
                  <DateTimeFields label="Window ends" value={windowEndsAt} onChange={setWindowEndsAt} />
                </div>

                <label className="flex flex-col gap-2">
                  <span className={cn(sketchLabel, "text-black/45")}>AI usage policy</span>
                  <textarea
                    value={aiUsagePolicy}
                    onChange={(e) => setAiUsagePolicy(e.target.value)}
                    placeholder="Optional. What assistance is allowed?"
                    rows={3}
                    className={cn(sketchInput, "resize-y")}
                  />
                </label>

                <div className="grid gap-6 sm:grid-cols-2">
                  <TextListEditor
                    label="Checklist"
                    placeholder="e.g. Working login"
                    items={checklist}
                    onChange={setChecklist}
                  />
                  <TextListEditor
                    label="Deliverables"
                    placeholder="e.g. Deployed URL"
                    items={requiredDeliverables}
                    onChange={setRequiredDeliverables}
                  />
                </div>
              </div>
            )}
          </div>
        </SketchBox>
      )}

      {loading ? (
        <SketchListSkeleton rows={5} />
      ) : error ? (
        <p className="text-[13px] text-black/70">{error}</p>
      ) : sessions.length === 0 ? (
        <SketchBox className="flex flex-col items-center px-8 py-16 text-center" tone="white">
          <p className={cn(sketchLabel, "text-black/35")}>Empty</p>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-black/70">
            No sessions yet. Create one when you are ready to observe a candidate’s work.
          </p>
          {!showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className={cn(sketchButtonSecondary, "mt-6")}
            >
              <Plus className="size-3.5" aria-hidden />
              New assessment
            </button>
          )}
        </SketchBox>
      ) : (
        <div className="flex flex-col gap-2.5">
          {sessions.map((session) => (
            <Link key={session.id} href={`${routePrefix}/assessments/${session.id}`} className="group">
              <SketchBox className="sketch-card-hover px-5 py-4 transition duration-200 group-hover:-translate-y-px">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium tracking-tight text-black">
                      {session.subjectRef}
                    </p>
                    <p className="mt-1 text-[12px] text-black/45">
                      Started {formatSessionDate(session.startedAt)}
                      {session.expectedStack.length > 0
                        ? ` · ${session.expectedStack.slice(0, 3).join(" · ")}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusPill status={session.status} />
                    <ArrowUpRight
                      className="size-4 text-black/20 transition group-hover:text-black/55"
                      aria-hidden
                    />
                  </div>
                </div>
              </SketchBox>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
