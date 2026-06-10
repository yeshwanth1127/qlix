"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Brain,
  Loader2,
  MessageSquare,
  SendHorizonal,
  ShieldCheck,
  Square,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import type { AgentDTO, AgentRuntime, OpenRouterCatalogEntry } from "@/lib/agents-api";
import {
  clearConversationMessages,
  fetchConversationMessages,
  fetchOpenRouterCatalog,
  getAgent,
  normalizeQlixInferenceModelId,
} from "@/lib/agents-api";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import { useSession } from "@/components/qlix/session-context";
import {
  AgentStatusBadge,
  agentStatusHint,
  deriveAgentDisplayStatus,
} from "@/components/qlix/agents/agentStatus";
import { cn } from "@/lib/utils/cn";

/** Cloud and hybrid agents use dashboard chat + backend inference proxy. */
function isHostedChatRuntime(runtime: AgentRuntime | undefined): boolean {
  return runtime === "cloud" || runtime === "hybrid";
}
import { ActivityTimeline } from "@/components/qlix/agents/AgentRunActivity";
import {
  type ActivityStep,
  getPendingJitStep,
  summarizeRunnerLog,
} from "@/components/qlix/agents/agentToolActivity";
import {
  AgentBrowserLiveView,
  type BrowserFrame,
} from "@/components/qlix/agents/AgentBrowserLiveView";

type ChatMsg = {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  activity?: ActivityStep[];
  browserFrames?: BrowserFrame[];
};

async function apiBase(): Promise<string> {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

async function fetchMessagesAfterRun(
  agentId: string,
  conversationId: string,
  runStatus: string | undefined,
): Promise<Array<{ id: string; role: string; content: string }> | null> {
  const delays = [0, 300, 600, 1000, 1500, 2500];
  for (const ms of delays) {
    if (ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    const rows = await fetchConversationMessages(agentId, conversationId);
    if (!rows) continue;
    const lastAgent = [...rows].reverse().find((m) => m.role === "agent");
    if (runStatus === "failed" || (lastAgent?.content?.trim() ?? "").length > 0) {
      return rows;
    }
  }
  return fetchConversationMessages(agentId, conversationId);
}

function mergeServerMessages(
  rows: Array<{ id: string; role: string; content: string }>,
  opts: {
    preservedContent: string;
    preservedActivity: ActivityStep[];
    preservedFrames: BrowserFrame[];
    runStatus?: string;
  },
): ChatMsg[] {
  let lastAgentIdx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.role === "agent") {
      lastAgentIdx = i;
      break;
    }
  }
  return rows.map((m, i) => {
    const role = (m.role as ChatMsg["role"]) ?? "system";
    const isLastAgent = i === lastAgentIdx;
    const serverContent = m.content ?? "";
    const content =
      isLastAgent && !serverContent.trim() && opts.preservedContent.trim()
        ? opts.preservedContent
        : serverContent;
    return {
      id: m.id,
      role,
      content,
      activity: isLastAgent && opts.preservedActivity.length > 0 ? opts.preservedActivity : undefined,
      browserFrames: isLastAgent && opts.preservedFrames.length > 0 ? opts.preservedFrames : undefined,
    };
  });
}

export function AgentChatPanel({
  agentId,
  aiBrainHref,
}: {
  readonly agentId: string;
  readonly aiBrainHref?: string;
}) {
  const { session } = useSession();
  const [agent, setAgent] = useState<AgentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  const streamRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** Streaming run state preserved across refetch on `done`. */
  const streamingActivityRef = useRef<ActivityStep[]>([]);
  const streamingContentRef = useRef("");
  const streamingBrowserFramesRef = useRef<BrowserFrame[]>([]);
  const catalogSyncedRef = useRef(false);
  /** Latest UI model choice — read in send() to avoid stale React state. */
  const selectedModelRef = useRef("");

  const [catalogModels, setCatalogModels] = useState<OpenRouterCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [selectedQlixModelId, setSelectedQlixModelId] = useState("");
  const [useBrain, setUseBrain] = useState(false);
  const [browserFrames, setBrowserFrames] = useState<BrowserFrame[]>([]);
  const [selectedImage, setSelectedImage] = useState<BrowserFrame | null>(null);

  useEffect(() => {
    selectedModelRef.current = selectedQlixModelId;
  }, [selectedQlixModelId]);

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getAgent(agentId).then((res) => {
      if (cancelled) return;
      if (!res) {
        setError("Agent not found");
        setAgent(null);
      } else {
        setAgent(res.agent);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    setCatalogModels([]);
    setCatalogError(null);
    setCatalogLoading(false);
    setModelSearch("");
    catalogSyncedRef.current = false;
    setSelectedQlixModelId("");
    selectedModelRef.current = "";
    setUseBrain(false);
    setBrowserFrames([]);
  }, [agentId]);

  useEffect(() => {
    if (!agent || !isHostedChatRuntime(agent.runtime)) return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    void fetchOpenRouterCatalog().then((r) => {
      if (cancelled) return;
      setCatalogLoading(false);
      if (r.ok) {
        setCatalogModels(r.models);
        setCatalogError(null);
      } else {
        setCatalogError(r.errorMessage);
        setSelectedQlixModelId(normalizeQlixInferenceModelId(agent.model));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agent?.id, agent?.runtime]);

  useEffect(() => {
    if (!agent || !isHostedChatRuntime(agent.runtime)) return;
    if (catalogModels.length === 0 || catalogSyncedRef.current) return;
    catalogSyncedRef.current = true;
    const want = normalizeQlixInferenceModelId(agent.model);
    const exact = catalogModels.find((m) => m.qlixModelId.toLowerCase() === want.toLowerCase());
    // Honor the agent's configured model. If it isn't found in the OpenRouter catalog,
    // keep the agent's model rather than silently defaulting to catalogModels[0]
    // (which would force an unrelated model like gpt-4o-mini on every run).
    const next = exact?.qlixModelId ?? want;
    setSelectedQlixModelId(next);
    selectedModelRef.current = next;
  }, [agent, catalogModels]);

  /** Canonical id of the model chosen when the agent was built (its configured default). */
  const agentDefaultModelId = useMemo(
    () => (agent ? normalizeQlixInferenceModelId(agent.model) : ""),
    [agent?.model],
  );

  const pickerModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    let list =
      q.length === 0
        ? catalogModels
        : catalogModels.filter(
            (m) =>
              m.name.toLowerCase().includes(q) ||
              m.id.toLowerCase().includes(q) ||
              m.qlixModelId.toLowerCase().includes(q),
          );
    const sel = selectedQlixModelId.trim();
    if (sel && !list.some((m) => m.qlixModelId === sel)) {
      // Always keep the selected model visible. Prefer the real catalog entry; if it
      // isn't in the catalog at all, synthesize one so the native <select> shows the
      // correct value instead of silently falling back to its first option.
      const hit =
        catalogModels.find((m) => m.qlixModelId === sel) ??
        ({ id: sel, name: sel.replace(/^openrouter\//, ""), contextLength: null, qlixModelId: sel } as OpenRouterCatalogEntry);
      list = [hit, ...list];
    }
    return list;
  }, [catalogModels, modelSearch, selectedQlixModelId]);

  useEffect(() => {
    if (!agent || agent.agentKind === "org_brain") return;
    let cancelled = false;
    const boot = async () => {
      setConversationId(null);
      setMessages([]);
      const base = await apiBase();
      const res = await fetch(`${base}/api/v1/agents/${encodeURIComponent(agentId)}/conversations`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { conversationId?: string };
      if (!body.conversationId || cancelled) return;
      setConversationId(body.conversationId);

      const mres = await fetch(
        `${base}/api/v1/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(body.conversationId)}/messages`,
        { credentials: "include" },
      );
      if (!mres.ok || cancelled) return;
      const mbody = (await mres.json()) as { messages?: Array<{ id: string; role: string; content: string }> };
      const ms =
        mbody.messages?.map((m) => ({
          id: m.id,
          role: (m.role as ChatMsg["role"]) ?? "system",
          content: m.content ?? "",
        })) ?? [];
      setMessages(ms);
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [agentId, agent]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: sending ? "auto" : "smooth" });
  }, [messages, sending]);

  // Auto-grow the composer textarea with its content (and reset after a send clears it).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  const header = useMemo(() => {
    if (!agent) return "Agent chat";
    return agent.name;
  }, [agent]);

  /** The model actually used for replies — the live picker choice for hosted runtimes, else the agent default. */
  const activeModelLabel = useMemo(() => {
    if (!agent) return "";
    const raw =
      isHostedChatRuntime(agent.runtime) && selectedQlixModelId ? selectedQlixModelId : agent.model;
    return raw.replace(/^openrouter\//, "");
  }, [agent?.runtime, agent?.model, selectedQlixModelId]);

  const browserScopesOk = useMemo(() => {
    if (!agent) return true;
    const ps = new Set(agent.permissionScopes);
    return ps.has("web.read") && ps.has("web.click");
  }, [agent?.permissionScopes]);

  const canUseBrain = useMemo(() => {
    if (!agent) return false;
    return isHostedChatRuntime(agent.runtime) && new Set(agent.permissionScopes).has("brain.query");
  }, [agent]);

  const send = async () => {
    if (!conversationId) return;
    const text = input.trim();
    if (!text) return;
    setInput("");
    setSending(true);
    setError(null);

    const base = await apiBase();
    const optimisticId = `local-${Date.now()}`;
    setMessages((prev) => [...prev, { id: optimisticId, role: "user", content: text }]);

    const payload: Record<string, unknown> = { content: text, skills: [] };
    const modelForSend = selectedModelRef.current.trim();
    if (isHostedChatRuntime(agent?.runtime) && modelForSend.length > 0) {
      payload.model = modelForSend;
    }
    if (canUseBrain && useBrain) {
      payload.useBrain = true;
    }

    const res = await fetch(
      `${base}/api/v1/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      setSending(false);
      let msg = "Failed to send message";
      try {
        const body = (await res.json()) as { error?: { message?: string; code?: string } };
        if (body?.error?.message) msg = body.error.message;
        if (res.status === 402) {
          const walletPath =
            session?.organization.workspaceKind === "organization"
              ? "/organization/billing"
              : "/individual/wallet";
          msg = `Insufficient wallet balance. Add credits to continue. Go to ${walletPath}`;
        }
      } catch {
        // ignore
      }
      setError(msg);
      return;
    }
    const body = (await res.json()) as { runId: string; messageId: string };
    setCurrentRunId(body.runId);

    streamRef.current?.close();
    const es = new EventSource(
      `${base}/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(body.runId)}/stream`,
      { withCredentials: true },
    );
    streamRef.current = es;

    const assistantId = `run-${body.runId}`;
    streamingActivityRef.current = [];
    streamingContentRef.current = "";
    streamingBrowserFramesRef.current = [];
    setBrowserFrames([]);
    setMessages((prev) => [...prev, { id: assistantId, role: "agent", content: "", activity: [] }]);

    es.addEventListener("delta", (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as { data?: { text?: string } };
        const t = payload?.data?.text ?? "";
        if (!t) return;
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + t } : m,
          );
          const stream = next.find((m) => m.id === assistantId);
          if (stream) streamingContentRef.current = stream.content;
          return next;
        });
      } catch {
        // ignore
      }
    });

    es.addEventListener("log", (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as { seq?: number; data?: unknown };
        const raw = payload.data;
        if (raw && typeof raw === "object") {
          const d = raw as Record<string, unknown>;
          if (d.message === "browser_frame" && typeof d.image_base64 === "string") {
            const frame: BrowserFrame = {
              id: `frame-${payload.seq ?? streamingBrowserFramesRef.current.length}`,
              tool: String(d.tool ?? "browser"),
              label: String(d.label ?? "Browser action"),
              mime: String(d.mime ?? "image/png"),
              imageBase64: d.image_base64,
            };
            streamingBrowserFramesRef.current = [...streamingBrowserFramesRef.current, frame];
            setBrowserFrames(streamingBrowserFramesRef.current);
            return;
          }
        }
        const step = summarizeRunnerLog(payload.seq ?? 0, payload.data);
        if (!step) return;
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === assistantId ? { ...m, activity: [...(m.activity ?? []), step] } : m,
          );
          const stream = next.find((m) => m.id === assistantId);
          if (stream?.activity) streamingActivityRef.current = stream.activity;
          return next;
        });
      } catch {
        // ignore
      }
    });

    es.addEventListener("done", (evt) => {
      setSending(false);
      setCurrentRunId(null);
      es.close();
      if (streamRef.current === es) streamRef.current = null;
      let runStatus: string | undefined;
      try {
        const raw = (evt as MessageEvent).data;
        if (typeof raw === "string" && raw.length > 0) {
          const parsed = JSON.parse(raw) as { status?: string };
          runStatus = parsed.status;
        }
      } catch {
        // ignore
      }
      void (async () => {
        if (runStatus !== "failed") {
          setError(null);
        }
        const preservedActivity = [...streamingActivityRef.current];
        const preservedContent = streamingContentRef.current;
        const preservedFrames = [...streamingBrowserFramesRef.current];
        streamingActivityRef.current = [];
        streamingContentRef.current = "";
        streamingBrowserFramesRef.current = [];

        const rows = await fetchMessagesAfterRun(agentId, conversationId, runStatus);
        if (rows) {
          const merged = mergeServerMessages(rows, {
            preservedContent,
            preservedActivity,
            preservedFrames,
            runStatus,
          });
          setMessages(merged);
          if (preservedFrames.length > 0) {
            setBrowserFrames(preservedFrames);
          }
        } else if (preservedContent.trim()) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === assistantId);
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              content: preservedContent,
              activity: preservedActivity.length > 0 ? preservedActivity : next[idx].activity,
              browserFrames: preservedFrames.length > 0 ? preservedFrames : next[idx].browserFrames,
            };
            return next;
          });
          if (preservedFrames.length > 0) setBrowserFrames(preservedFrames);
        }
        if (runStatus === "failed") {
          setError(
            "The agent run failed. Check the brown system line in the thread for the error text, or Docker/API logs.",
          );
        }
      })();
      textareaRef.current?.focus();
    });

    es.onerror = () => {
      setSending(false);
      setCurrentRunId(null);
      es.close();
      if (streamRef.current === es) streamRef.current = null;
      const preservedActivity = [...streamingActivityRef.current];
      const preservedContent = streamingContentRef.current;
      const preservedFrames = [...streamingBrowserFramesRef.current];
      void fetchMessagesAfterRun(agentId, conversationId, undefined).then((rows) => {
        if (rows) {
          setMessages(
            mergeServerMessages(rows, {
              preservedContent,
              preservedActivity,
              preservedFrames,
            }),
          );
          if (preservedFrames.length > 0) setBrowserFrames(preservedFrames);
        } else if (preservedContent.trim()) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === assistantId);
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              content: preservedContent,
              activity: preservedActivity,
              browserFrames: preservedFrames,
            };
            return next;
          });
        }
      });
      setError(
        "Lost connection to the live reply stream. If the bubble stayed empty, open DevTools → Network and inspect the EventSource request for this run.",
      );
    };
  };

  const stopRun = async () => {
    if (!currentRunId || !sending) return;
    setSending(false);
    setCurrentRunId(null);
    streamRef.current?.close();
    streamRef.current = null;
    const base = await apiBase();
    try {
      await fetch(
        `${base}/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(currentRunId)}/stop`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
    } catch {
      // Ignore errors on stop; stream is closed anyway
    }
  };

  const clearChat = async () => {
    if (!conversationId || clearing) return;
    if (!window.confirm("Clear all messages in this chat?")) return;
    setClearing(true);
    setError(null);
    streamRef.current?.close();
    streamRef.current = null;
    const ok = await clearConversationMessages(agentId, conversationId);
    setClearing(false);
    setSending(false);
    if (!ok) {
      setError("Failed to clear messages");
      return;
    }
    setMessages([]);
    setBrowserFrames([]);
  };

  const lastAgentStreaming =
    sending &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === "agent" &&
    messages[messages.length - 1]?.content === "";

  const runnerStatus = agent ? deriveAgentDisplayStatus(agent) : null;
  const statusHint = runnerStatus ? agentStatusHint(runnerStatus) : null;
  const runnerDegraded =
    agent?.agentKind !== "org_brain" &&
    (runnerStatus === "runner_failed" || runnerStatus === "offline" || runnerStatus === "provisioning");
  const isOrgBrain = agent?.agentKind === "org_brain";
  const lastMsgFrames =
    messages.length > 0 ? messages[messages.length - 1]?.browserFrames : undefined;
  // Only show the browser live view once a browser tool has actually run (frames
  // arrive via `browser_frame` events). Don't show it merely because a run is in
  // progress — a chat/greeting run never touches the browser.
  const showBrowserLive =
    agent?.runtime === "cloud" &&
    !isOrgBrain &&
    (browserFrames.length > 0 || (lastMsgFrames?.length ?? 0) > 0);

  if (!loading && isOrgBrain) {
    return (
      <ReflectiveCard
        className="relative flex h-[calc(100vh-10rem)] min-h-[520px] flex-col items-center justify-center overflow-hidden rounded-xl border border-violet-500/15 p-8 text-center ring-1 ring-violet-400/15 dark:border-violet-400/25"
        contentClassName="flex flex-col items-center justify-center gap-4"
      >
        <div className="flex size-14 items-center justify-center rounded-2xl bg-violet-500/15 ring-1 ring-violet-400/30">
          <Brain className="size-7 text-violet-600 dark:text-violet-300" aria-hidden />
        </div>
        <div className="space-y-2">
          <h2 className="text-[15px] font-semibold text-[--text-primary]">{agent.name}</h2>
          {runnerStatus ? <AgentStatusBadge status={runnerStatus} /> : null}
          <p className="max-w-sm text-[13px] leading-relaxed text-[--text-secondary]">
            The org AI brain answers knowledge queries on the AI Brain page — it does not use a chat runner.
          </p>
        </div>
        {aiBrainHref ? (
          <Link
            href={aiBrainHref}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-violet-500 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            Open AI Brain
          </Link>
        ) : null}
      </ReflectiveCard>
    );
  }

  return (
    <ReflectiveCard
      className="relative h-[calc(100vh-10rem)] min-h-[520px] overflow-hidden rounded-xl border border-violet-500/15 ring-1 ring-violet-400/15 dark:border-violet-400/25"
      contentClassName="h-full"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/50 to-transparent" />

      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-[--border-subtle] bg-gradient-to-r from-violet-500/[0.06] via-transparent to-cyan-500/[0.05] px-4 py-3.5 dark:from-violet-500/10 dark:to-cyan-500/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/25 to-cyan-500/15 ring-1 ring-violet-400/25">
                  <Bot className="size-4 text-violet-600 dark:text-violet-300" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-[14px] font-semibold tracking-tight text-[--text-primary]">
                    {header}
                  </h2>
                  {agent ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {runnerStatus ? <AgentStatusBadge status={runnerStatus} /> : null}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ring-inset",
                          agent.runtime === "cloud"
                            ? "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300"
                            : "bg-teal-500/12 text-teal-800 ring-teal-500/25 dark:text-teal-300",
                        )}
                      >
                        {agent.runtime}
                      </span>
                      {activeModelLabel ? (
                        <span
                          className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 ring-1 ring-[--border-subtle]"
                          title={`Default: ${agent.model}`}
                        >
                          <Sparkles className="size-2.5 shrink-0 text-[--accent]" aria-hidden />
                          <span className="truncate font-mono text-[10px] text-[--text-secondary]">
                            {activeModelLabel}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void clearChat()}
              disabled={!conversationId || clearing || sending || messages.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[--border-subtle] px-2.5 py-1.5 text-[11px] font-medium text-[--text-secondary] transition-colors hover:border-[--danger]/40 hover:bg-red-950/20 hover:text-[--danger] disabled:opacity-40"
            >
              <Trash2 className="size-3.5" aria-hidden />
              {clearing ? "Clearing…" : "Clear"}
            </button>
          </div>
          {agent && runnerDegraded && statusHint ? (
            <p
              className={cn(
                "mt-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
                runnerStatus === "runner_failed"
                  ? "border-rose-500/35 bg-rose-500/10 text-rose-800 dark:text-rose-200"
                  : runnerStatus === "provisioning"
                    ? "border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                    : "border-slate-500/30 bg-slate-500/10 text-[--text-secondary]",
              )}
              role="status"
            >
              {statusHint}
            </p>
          ) : null}
        </div>

        {showBrowserLive ? (
          <div className="border-b border-[--border-subtle] lg:hidden">
            <AgentBrowserLiveView
              frames={browserFrames.length > 0 ? browserFrames : (lastMsgFrames ?? [])}
              active={sending}
              compact
              onImageClick={(frame) => setSelectedImage(frame)}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-scroll px-4 py-4 [scrollbar-gutter:stable]"
            style={{ scrollbarWidth: "thin" }}
          >
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-[--text-secondary]">
              <Loader2 className="size-8 animate-spin text-[--accent]" aria-hidden />
              <p className="text-[13px]">Opening conversation…</p>
            </div>
          ) : error ? (
            <p className="rounded-lg border border-red-500/30 bg-red-950/25 px-3 py-2 text-[12px] text-red-200">{error}</p>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-[--accent]/10 ring-1 ring-[--accent]/25">
                    <MessageSquare className="size-7 text-[--accent]" aria-hidden />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[14px] font-medium text-[--text-primary]">Start a conversation</p>
                    <p className="max-w-xs text-[12px] leading-relaxed text-[--text-tertiary]">
                      Messages stream in real time while the runner processes your request. Activity steps appear above
                      each reply when the backend reports them.
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((m) => {
                  const isLast = m.id === messages[messages.length - 1]?.id;
                  const thisStreaming = sending && m.role === "agent" && isLast;
                  const jitPendingStep =
                    thisStreaming && m.activity ? getPendingJitStep(m.activity) : null;
                  return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex gap-2",
                      m.role === "user" ? "flex-row-reverse" : "flex-row",
                      m.role === "system" && "justify-center",
                    )}
                  >
                    {m.role !== "system" ? (
                      <div
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ring-1",
                          m.role === "user"
                            ? "bg-[--accent]/20 ring-[--accent]/30"
                            : "bg-[var(--glass-muted-bg)] ring-[--border-subtle]",
                        )}
                        aria-hidden
                      >
                        {m.role === "user" ? (
                          <UserRound className="size-4 text-[--accent]" />
                        ) : (
                          <Bot className="size-4 text-[--text-secondary]" />
                        )}
                      </div>
                    ) : null}

                    <div
                      className={cn(
                        "min-w-0 max-w-[min(100%,28rem)] rounded-2xl px-3.5 py-3 text-[13px] leading-relaxed shadow-sm",
                        m.role === "user" &&
                          "rounded-br-md bg-gradient-to-br from-[--accent]/20 to-[--accent]/10 text-[--text-primary] ring-1 ring-[--accent]/25",
                        m.role === "agent" &&
                          "rounded-bl-md bg-[var(--glass-row-hover)]/90 text-[--text-primary] ring-1 ring-[--border-subtle]",
                        m.role === "system" &&
                          "max-w-full rounded-lg bg-amber-950/30 px-3 py-2 text-center text-[12px] text-amber-100/90 ring-1 ring-amber-500/20",
                      )}
                    >
                      {m.role === "agent" && m.activity && m.activity.length > 0 ? (
                        <ActivityTimeline
                          steps={m.activity}
                          running={thisStreaming}
                          defaultOpen={thisStreaming}
                          className="mb-3"
                        />
                      ) : null}
                      {jitPendingStep ? (
                        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                          <ShieldCheck
                            className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-200"
                            aria-hidden
                          />
                          <div className="min-w-0 text-[11px] leading-snug text-amber-950 dark:text-amber-50">
                            <span className="font-semibold">{jitPendingStep.label}</span>
                            {jitPendingStep.detail ? (
                              <span className="mt-0.5 block text-[10px] opacity-90">
                                {jitPendingStep.detail}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {m.role === "agent" && (!m.content || m.content.trim() === "") && lastAgentStreaming && m.id === messages[messages.length - 1]?.id ? (
                        <div className="flex items-center gap-1.5 py-1 text-[12px] text-[--text-tertiary]">
                          <span className="inline-flex gap-1">
                            <span className="animate-bounce [animation-delay:-0.2s]">●</span>
                            <span className="animate-bounce [animation-delay:-0.1s]">●</span>
                            <span className="animate-bounce">●</span>
                          </span>
                          <span>Thinking…</span>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap text-[13px]">{m.content}</div>
                      )}
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          )}
          </div>

          {showBrowserLive ? (
            <AgentBrowserLiveView
              frames={browserFrames.length > 0 ? browserFrames : (lastMsgFrames ?? [])}
              active={sending}
              className="hidden min-h-0 w-[min(42%,380px)] shrink-0 lg:flex"
              onImageClick={(frame) => setSelectedImage(frame)}
            />
          ) : null}
        </div>

        <div className="border-t border-[--border-subtle] bg-[var(--glass-inset-bg)]/30 px-4 py-3">
          <div className="mx-auto max-w-2xl space-y-2">
            {isHostedChatRuntime(agent?.runtime) && catalogError ? (
              <p className="text-[10px] leading-snug text-amber-300/90">{catalogError}</p>
            ) : null}

            <div className="rounded-2xl border border-[--border-subtle] bg-[--bg-base]/70 shadow-inner transition-[border-color,box-shadow] focus-within:border-[--accent]/60 focus-within:ring-2 focus-within:ring-[--accent]/15">
              {isHostedChatRuntime(agent?.runtime) || canUseBrain ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-[--border-subtle]/60 px-2.5 py-1.5">
                  {isHostedChatRuntime(agent?.runtime) ? (
                    catalogLoading ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-[--text-tertiary]">
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        Loading models…
                      </span>
                    ) : catalogModels.length > 0 ? (
                      <label className="inline-flex min-w-0 items-center gap-1.5 text-[--text-secondary]">
                        <Sparkles className="size-3.5 shrink-0 text-[--accent]" aria-hidden />
                        <select
                          value={selectedQlixModelId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSelectedQlixModelId(v);
                            selectedModelRef.current = v;
                          }}
                          disabled={!conversationId || pickerModels.length === 0}
                          title="Model used for each reply (OpenRouter catalog)"
                          className="max-w-[220px] truncate rounded-md border border-transparent bg-transparent py-1 pl-1 pr-5 text-[11px] font-medium text-[--text-primary] outline-none hover:border-[--border-subtle] focus:border-violet-500/50 disabled:opacity-50"
                        >
                          {pickerModels.length === 0 ? (
                            selectedQlixModelId.trim() ? (
                              <option className="bg-white text-black" value={selectedQlixModelId}>
                                {selectedQlixModelId}
                              </option>
                            ) : (
                              <option className="bg-white text-black" value="">
                                No matches
                              </option>
                            )
                          ) : (
                            pickerModels.map((m) => {
                              const isAgentDefault =
                                agentDefaultModelId.length > 0 &&
                                m.qlixModelId.toLowerCase() === agentDefaultModelId.toLowerCase();
                              return (
                                <option
                                  key={m.qlixModelId}
                                  className="bg-white text-black"
                                  value={m.qlixModelId}
                                >
                                  {isAgentDefault ? `${m.name} (agent default)` : m.name}
                                </option>
                              );
                            })
                          )}
                        </select>
                      </label>
                    ) : (
                      <span className="text-[11px] text-[--text-tertiary]">
                        {catalogError ? "Model catalog unavailable" : "No models returned"}
                      </span>
                    )
                  ) : null}
                  {canUseBrain ? (
                    <button
                      type="button"
                      onClick={() => setUseBrain((v) => !v)}
                      disabled={!conversationId || sending}
                      aria-pressed={useBrain}
                      title="When on, the runner pulls snippets from your org AI Brain before answering (requires a provisioned brain and ingested documents)."
                      className={cn(
                        "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors disabled:opacity-50",
                        useBrain
                          ? "bg-[--accent]/15 text-[--accent] ring-[--accent]/35"
                          : "bg-transparent text-[--text-tertiary] ring-[--border-subtle] hover:text-[--text-secondary]",
                      )}
                    >
                      <Brain className="size-3.5 shrink-0" aria-hidden />
                      Company knowledge
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-end gap-2 p-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={conversationId ? "Message your agent…" : "Initializing…"}
                  disabled={!conversationId || sending}
                  rows={1}
                  className="min-h-[40px] max-h-[160px] w-full resize-none self-center border-0 bg-transparent px-2 py-2 text-[13px] leading-snug text-[--text-primary] outline-none placeholder:text-[--text-tertiary] disabled:opacity-60"
                />
                {sending ? (
                  <button
                    type="button"
                    onClick={() => void stopRun()}
                    title="Stop the current execution"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-orange-600 text-white shadow-sm shadow-red-500/25 motion-safe:transition-[filter] hover:brightness-110 dark:from-red-500 dark:to-orange-500"
                  >
                    <Square className="size-4 fill-current" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={
                      !conversationId ||
                      input.trim().length === 0 ||
                      (isHostedChatRuntime(agent?.runtime) && selectedQlixModelId.trim().length === 0)
                    }
                    title="Send (Enter · Shift+Enter for newline)"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-sm shadow-violet-500/25 motion-safe:transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 dark:from-violet-500 dark:to-cyan-500"
                  >
                    <SendHorizonal className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            {agent?.runtime === "cloud" && !browserScopesOk ? (
              <p className="text-[10px] leading-snug text-amber-300/90">
                Grant this agent <span className="font-mono">web.read</span> and{" "}
                <span className="font-mono">web.click</span> (create/edit agent) to enable browser tools.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {selectedImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setSelectedImage(null)}
          onKeyDown={(e) => e.key === "Escape" && setSelectedImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative flex h-full max-h-[90vh] max-w-4xl items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${selectedImage.mime || "image/png"};base64,${selectedImage.imageBase64}`}
              alt={selectedImage.label}
              className="max-h-full max-w-full object-contain rounded-lg"
            />
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 right-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-black/50 text-white transition-colors hover:bg-black/75"
              title="Close fullscreen"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {selectedImage.label && (
              <div className="absolute bottom-4 left-4 rounded-lg bg-black/75 px-3 py-2 text-white text-sm">
                <p className="font-medium">{selectedImage.label}</p>
                <p className="text-xs text-gray-300">{selectedImage.tool}</p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </ReflectiveCard>
  );
}
