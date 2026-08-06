"use client";

import { useEffect, useState } from "react";
import {
  SketchBox,
  SketchPageHeader,
  SketchSection,
  sketchButton,
  sketchButtonPrimary,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

type Schedule = {
  id: string;
  agentId: string;
  cronExpression: string;
  label: string | null;
  prompt: string;
  enabled: boolean;
};

export default function OrganizationSchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [agentId, setAgentId] = useState("");
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch(`${apiBase()}/api/v1/employee-schedules`, { credentials: "include" });
    if (!res.ok) {
      setError("Failed to load schedules");
      return;
    }
    const body = (await res.json()) as { schedules: Schedule[] };
    setSchedules(body.schedules ?? []);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase()}/api/v1/employee-schedules`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          cronExpression: cron,
          prompt,
          enabled: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Create failed");
      }
      setPrompt("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-auto pb-6">
      <SketchPageHeader title="Schedules" />
      <SketchSection title="New schedule">
        <SketchBox className="flex flex-col gap-3 p-4">
          {error ? <p className="text-[13px] text-[color:var(--sketch-red)]">{error}</p> : null}
          <label className="block">
            <span className={sketchLabel}>Agent id</span>
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className={`${sketchInput} mt-1`}
              placeholder="agent cuid"
            />
          </label>
          <label className="block">
            <span className={sketchLabel}>Cron</span>
            <input value={cron} onChange={(e) => setCron(e.target.value)} className={`${sketchInput} mt-1`} />
          </label>
          <label className="block">
            <span className={sketchLabel}>Prompt</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className={`${sketchInput} mt-1 min-h-[80px]`}
            />
          </label>
          <button
            type="button"
            disabled={busy || !agentId || !prompt.trim()}
            className={sketchButtonPrimary}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create schedule"}
          </button>
        </SketchBox>
      </SketchSection>
      <SketchSection title="Existing">
        <SketchBox className="p-0">
          {schedules.length === 0 ? (
            <p className="p-4 text-[13px] text-black/50">No schedules yet.</p>
          ) : (
            <ul className="divide-y divide-black/10">
              {schedules.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 p-4">
                  <div>
                    <p className="font-mono text-[12px] text-black">{s.cronExpression}</p>
                    <p className="mt-1 text-[12px] text-black/60">{s.prompt}</p>
                    <p className="mt-1 text-[11px] text-black/40">
                      agent {s.agentId} · {s.enabled ? "enabled" : "paused"}
                      {s.label ? ` · ${s.label}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={sketchButton}
                    onClick={() => {
                      void fetch(`${apiBase()}/api/v1/employee-schedules/${encodeURIComponent(s.id)}`, {
                        method: "PATCH",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ enabled: !s.enabled }),
                      }).then(() => refresh());
                    }}
                  >
                    {s.enabled ? "Pause" : "Enable"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SketchBox>
      </SketchSection>
    </div>
  );
}
