"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Brain,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  SendHorizonal,
  ShieldCheck,
  Square,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { AgentDTO, AgentRuntime, ChatAttachmentDTO, ModelCatalogEntry } from "@/lib/agents-api";
import {
  buildProxyModelGroups,
  clearConversationMessages,
  fetchConversationMessages,
  fetchModelCatalog,
  getAgent,
  getRuntimeStatus,
  normalizeQlixInferenceModelId,
  type ConversationMessageDTO,
} from "@/lib/agents-api";
import { decideJit, listPendingJit, type PendingJitDTO } from "@/lib/jit-api";
import { useSession } from "@/components/qlix/session-context";
import { agentStatusHint, deriveAgentDisplayStatus } from "@/components/qlix/agents/agentStatus";
import {
  SketchBox,
  sketchButton,
  sketchButtonDanger,
  sketchButtonGhost,
  sketchButtonPrimary,
  sketchButtonSecondary,
  sketchLabel,
  sketchToneBg,
  type SketchTone,
} from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";
import { ActivityTimeline } from "@/components/qlix/agents/AgentRunActivity";
import { ModelHierarchyPicker } from "@/components/qlix/agents/ModelHierarchyPicker";
import {
  type ActivityStep,
  getPendingJitStep,
  summarizeRunnerLog,
} from "@/components/qlix/agents/agentToolActivity";
import {
  AgentBrowserLiveView,
  type BrowserFrame,
} from "@/components/qlix/agents/AgentBrowserLiveView";
import { AgentMessageContent } from "@/components/qlix/agents/AgentMessageContent";
import { safeModelOutputUrl } from "@/lib/safe-model-output";

function statusBadgeTone(status: string): SketchTone {
  const s = status.toLowerCase();
  if (s.includes("online") || s.includes("ready") || s === "running") return "green";
  if (s.includes("provision")) return "amber";
  if (s.includes("fail") || s.includes("offline")) return "rose";
  return "blue";
}

function SketchStatusBadge({ status }: { readonly status: string }) {
  const tone = statusBadgeTone(status);
  const s = status.toLowerCase();
  const live = s.includes("online") || s.includes("ready") || s === "running";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-black/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-black/70",
        sketchToneBg[tone],
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          live && "bg-[color:var(--sketch-green)]",
          tone === "rose" && "bg-[color:var(--sketch-red)]",
          tone === "amber" && "bg-[color:var(--warning)]",
          !live && tone !== "rose" && tone !== "amber" && "bg-black/30",
        )}
        aria-hidden
      />
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** Cloud and hybrid agents use dashboard chat + backend inference proxy. */
function isHostedChatRuntime(runtime: AgentRuntime | undefined): boolean {
  return runtime === "cloud" || runtime === "hybrid";
}

type ChatMsg = {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  attachments?: ChatAttachmentDTO[];
  activity?: ActivityStep[];
  browserFrames?: BrowserFrame[];
};

const CHAT_MAX_FILES = 8;
const CHAT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const CHAT_MAX_FILE_MB = 50;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseAttachments(raw: unknown): ChatAttachmentDTO[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ChatAttachmentDTO[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (
      typeof a.id === "string" &&
      typeof a.fileName === "string" &&
      typeof a.mimeType === "string" &&
      typeof a.url === "string" &&
      typeof a.sizeBytes === "number"
    ) {
      out.push({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        url: a.url,
        sizeBytes: a.sizeBytes,
        ...(typeof a.textPreview === "string" ? { textPreview: a.textPreview } : {}),
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function toChatMsg(m: ConversationMessageDTO): ChatMsg {
  return {
    id: m.id,
    role: (m.role as ChatMsg["role"]) ?? "system",
    content: m.content ?? "",
    attachments: parseAttachments(m.attachments),
  };
}

function MessageAttachments({ attachments }: { readonly attachments: ChatAttachmentDTO[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {attachments.map((a) => (
        <li key={a.id}>
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-black/12 bg-white/60 px-2.5 py-1.5 text-[11px] text-black/75 transition-colors hover:bg-white hover:text-black"
          >
            <FileText className="size-3 shrink-0" aria-hidden />
            <span className="truncate font-medium">{a.fileName}</span>
            <span className="shrink-0 text-black/40">{formatFileSize(a.sizeBytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// Render message text with clickable links (no markdown dependency). Supports
// [label](url) and bare URLs; only http(s) is linkified — never sandbox:/javascript:.
// Newlines are preserved by the parent's whitespace-pre-wrap.
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"])/g;

function renderWithLinks(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let key = 0;
  const link = (href: string, label: string) => {
    const safeHref = safeModelOutputUrl(href);
    if (!safeHref) return label;
    return (
      <a
        key={`k${key++}`}
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all hover:opacity-70"
      >
        {label}
      </a>
    );
  };
  const pushPlain = (segment: string) => {
    let li = 0;
    let bm: RegExpExecArray | null;
    BARE_URL_RE.lastIndex = 0;
    while ((bm = BARE_URL_RE.exec(segment)) !== null) {
      if (bm.index > li) nodes.push(segment.slice(li, bm.index));
      nodes.push(link(bm[1], bm[1]));
      li = bm.index + bm[1].length;
    }
    if (li < segment.length) nodes.push(segment.slice(li));
  };
  let last = 0;
  let m: RegExpExecArray | null;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    if (m.index > last) pushPlain(text.slice(last, m.index));
    nodes.push(link(m[2], m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) pushPlain(text.slice(last));
  return nodes;
}

async function apiBase(): Promise<string> {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

async function fetchMessagesAfterRun(
  agentId: string,
  conversationId: string,
  runStatus: string | undefined,
): Promise<ConversationMessageDTO[] | null> {
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
  rows: ConversationMessageDTO[],
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
      attachments: parseAttachments(m.attachments),
      activity: isLastAgent && opts.preservedActivity.length > 0 ? opts.preservedActivity : undefined,
      browserFrames: isLastAgent && opts.preservedFrames.length > 0 ? opts.preservedFrames : undefined,
    };
  });
}

function mergePendingJitIntoMessages(messages: ChatMsg[], pending: PendingJitDTO[]): ChatMsg[] {
  if (pending.length === 0) return messages;
  const latest = pending[0];
  if (!latest) return messages;

  let lastAgentIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "agent") {
      lastAgentIdx = i;
      break;
    }
  }
  if (lastAgentIdx < 0) return messages;

  const msg = messages[lastAgentIdx]!;
  const existing = msg.activity ?? [];
  if (existing.some((s) => s.jitRequestId === latest.jitRequestId)) return messages;
  if (getPendingJitStep(existing)) return messages;

  const sessionScoped =
    latest.scope === "email.send" ||
    latest.scope === "social.publish" ||
    latest.scope === "crm.write" ||
    latest.scope === "crm.delete" ||
    latest.scope === "whatsapp.contact_send";

  const step: ActivityStep = {
    id: `jit-pending-${latest.jitRequestId}`,
    label: "Waiting for your approval",
    detail: [
      "Waiting for your approval in Qlix",
      latest.scopeLabel ? `Scope: ${latest.scopeLabel}` : "",
      sessionScoped ? "Approving covers this whole conversation" : "",
      latest.context,
    ]
      .filter(Boolean)
      .join(" · "),
    tone: "warn",
    kind: "jit_pending",
    category: "approval",
    jitRequestId: latest.jitRequestId,
    jitChannel: "dashboard",
    jitScope: latest.scope,
  };

  const next = [...messages];
  next[lastAgentIdx] = { ...msg, activity: [...existing, step] };
  return next;
}

export function AgentChatPanel({
  agentId,
  backHref,
  aiBrainHref,
}: {
  readonly agentId: string;
  readonly backHref: string;
  readonly aiBrainHref?: string;
}) {
  const { session } = useSession();
  const [agent, setAgent] = useState<AgentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  const streamRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Streaming run state preserved across refetch on `done`. */
  const streamingActivityRef = useRef<ActivityStep[]>([]);
  const streamingContentRef = useRef("");
  const streamingBrowserFramesRef = useRef<BrowserFrame[]>([]);
  const catalogSyncedRef = useRef(false);
  /** Latest UI model choice — read in send() to avoid stale React state. */
  const selectedModelRef = useRef("");

  const [exoraCatalog, setExoraCatalog] = useState<ModelCatalogEntry[]>([]);
  const [openrouterCatalog, setOpenrouterCatalog] = useState<ModelCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedQlixModelId, setSelectedQlixModelId] = useState("");
  const [useBrain, setUseBrain] = useState(false);
  const [browserFrames, setBrowserFrames] = useState<BrowserFrame[]>([]);
  const [selectedImage, setSelectedImage] = useState<BrowserFrame | null>(null);
  /** JIT requests being resolved from the chat (id -> in-flight) to disable buttons. */
  const [jitDeciding, setJitDeciding] = useState<Record<string, boolean>>({});
  const [jitError, setJitError] = useState<string | null>(null);

  useEffect(() => {
    selectedModelRef.current = selectedQlixModelId;
  }, [selectedQlixModelId]);

  const handleJitDecision = async (jitRequestId: string, approved: boolean) => {
    if (jitDeciding[jitRequestId]) return;
    setJitDeciding((p) => ({ ...p, [jitRequestId]: true }));
    setJitError(null);
    const res = await decideJit(jitRequestId, approved);
    if (!res.ok) {
      setJitError(res.errorMessage);
      setJitDeciding((p) => ({ ...p, [jitRequestId]: false }));
      return;
    }
    // Resolve the pending step locally so buttons disappear immediately; the runner
    // polls jit/poll and continues the run, streaming any further activity.
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.activity) return m;
        return {
          ...m,
          activity: m.activity.map((s) =>
            s.kind === "jit_pending" && s.jitRequestId === jitRequestId
              ? {
                  ...s,
                  kind: "jit_resolved" as const,
                  tone: approved ? ("success" as const) : ("warn" as const),
                  label: approved ? "You approved the action" : "You denied the action",
                }
              : s,
          ),
        };
      }),
    );
  };

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

  /** Recover approval cards missed by the run SSE stream (e.g. JIT logged after run_result). */
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    const syncPendingJit = async () => {
      const pending = await listPendingJit(conversationId, agentId);
      if (cancelled || pending.length === 0) return;
      setMessages((prev) => mergePendingJitIntoMessages(prev, pending));
    };
    void syncPendingJit();
    const interval = setInterval(syncPendingJit, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [conversationId, agentId]);

  /** Keep hybrid/cloud online badge in sync — status uses a 20s heartbeat window. */
  useEffect(() => {
    if (!agent || (agent.runtime !== "cloud" && agent.runtime !== "hybrid")) return;
    let cancelled = false;
    const tick = async () => {
      const s = await getRuntimeStatus(agent.id);
      if (cancelled || !s) return;
      setAgent((prev) => {
        if (!prev || prev.id !== agent.id) return prev;
        if (prev.runtime === "hybrid") {
          if (prev.hybridLastHeartbeatAt === s.lastHeartbeatAt) return prev;
          return { ...prev, hybridLastHeartbeatAt: s.lastHeartbeatAt };
        }
        const nextStatus =
          s.provisioningStatus === "provisioning" ? "running" : (s.provisioningStatus ?? prev.cloudProvisioningStatus);
        if (
          prev.cloudLastHeartbeatAt === s.lastHeartbeatAt &&
          prev.cloudProvisioningStatus === nextStatus
        ) {
          return prev;
        }
        return {
          ...prev,
          cloudLastHeartbeatAt: s.lastHeartbeatAt ?? prev.cloudLastHeartbeatAt,
          cloudProvisioningStatus: nextStatus,
          cloudProvisioningError: s.provisioningError ?? null,
        };
      });
    };
    void tick();
    const t = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [agent?.id, agent?.runtime]);

  useEffect(() => {
    setExoraCatalog([]);
    setOpenrouterCatalog([]);
    setCatalogError(null);
    setCatalogLoading(false);
    catalogSyncedRef.current = false;
    setSelectedQlixModelId("");
    selectedModelRef.current = "";
    setUseBrain(false);
    setBrowserFrames([]);
    setPendingFiles([]);
    setFileInputKey((k) => k + 1);
    setFileError(null);
  }, [agentId]);

  useEffect(() => {
    if (!agent || !isHostedChatRuntime(agent.runtime)) return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    void Promise.all([fetchModelCatalog("exora"), fetchModelCatalog("openrouter")]).then(
      ([exoraResult, openrouterResult]) => {
        if (cancelled) return;
        setCatalogLoading(false);
        setExoraCatalog(exoraResult.ok ? exoraResult.models : []);
        setOpenrouterCatalog(openrouterResult.ok ? openrouterResult.models : []);
        if (!exoraResult.ok && !openrouterResult.ok) {
          setCatalogError(exoraResult.errorMessage || openrouterResult.errorMessage);
          setSelectedQlixModelId(
            normalizeQlixInferenceModelId(agent.model, agent.llmProvider),
          );
        } else {
          setCatalogError(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [agent?.id, agent?.runtime, agent?.llmProvider]);

  useEffect(() => {
    if (!agent || !isHostedChatRuntime(agent.runtime)) return;
    if (catalogSyncedRef.current) return;
    catalogSyncedRef.current = true;
    const want = normalizeQlixInferenceModelId(agent.model, agent.llmProvider);
    setSelectedQlixModelId(want);
    selectedModelRef.current = want;
  }, [agent, exoraCatalog, openrouterCatalog]);

  /** Canonical id of the model chosen when the agent was built (its configured default). */
  const agentDefaultModelId = useMemo(
    () =>
      agent
        ? normalizeQlixInferenceModelId(agent.model, agent.llmProvider)
        : "",
    [agent?.model, agent?.llmProvider],
  );

  const pickerGroups = useMemo(
    () =>
      buildProxyModelGroups({
        exoraCatalog,
        openrouterCatalog,
        selectedModel: selectedQlixModelId || agentDefaultModelId,
      }),
    [agentDefaultModelId, exoraCatalog, openrouterCatalog, selectedQlixModelId],
  );

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
      const mbody = (await mres.json()) as { messages?: ConversationMessageDTO[] };
      const ms = mbody.messages?.map(toChatMsg) ?? [];
      setMessages(ms);
    };
    void boot();
    return () => {
      cancelled = true;
    };
    // Depend on the agent's identity only — the heartbeat poll replaces the `agent`
    // object every few seconds, and re-booting the conversation on each tick nulls
    // conversationId, which disables (and blurs) the composer while the user types.
  }, [agentId, agent?.id, agent?.agentKind]);

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

  const canUseBrain = useMemo(() => {
    if (!agent) return false;
    return isHostedChatRuntime(agent.runtime) && new Set(agent.permissionScopes).has("brain.query");
  }, [agent]);

  const addPendingFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    const oversized = picked.filter((f) => f.size > CHAT_MAX_FILE_BYTES);
    if (oversized.length > 0) {
      const names = oversized.map((f) => f.name).join(", ");
      setFileError(
        oversized.length === 1
          ? `"${names}" is too large (max ${CHAT_MAX_FILE_MB} MB).`
          : `These files are too large (max ${CHAT_MAX_FILE_MB} MB each): ${names}`,
      );
      picked = picked.filter((f) => f.size <= CHAT_MAX_FILE_BYTES);
      if (picked.length === 0) return;
    } else {
      setFileError(null);
    }
    setPendingFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const file of picked) {
        if (merged.length >= CHAT_MAX_FILES) break;
        const key = `${file.name}:${file.size}`;
        if (!existing.has(key)) {
          existing.add(key);
          merged.push(file);
        }
      }
      return merged;
    });
  };

  const send = async () => {
    if (!conversationId) return;
    const text = input.trim();
    const filesToSend = [...pendingFiles];
    if (!text && filesToSend.length === 0) return;

    const base = await apiBase();

    // Mid-run steer: while a run is active, inject guidance instead of starting a new run.
    if (sending && currentRunId && text && filesToSend.length === 0) {
      setInput("");
      setError(null);
      const optimisticId = `steer-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: optimisticId, role: "user", content: `[steer] ${text}` },
      ]);
      try {
        const res = await fetch(
          `${base}/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(currentRunId)}/inject`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text }),
          },
        );
        if (!res.ok) {
          let msg = "Failed to steer run";
          try {
            const body = (await res.json()) as { error?: { message?: string } };
            if (body?.error?.message) msg = body.error.message;
          } catch {
            // ignore
          }
          setError(msg);
        }
      } catch {
        setError("Failed to steer run");
      }
      return;
    }

    setInput("");
    setPendingFiles([]);
    setFileInputKey((k) => k + 1);
    setSending(true);
    setError(null);

    const optimisticId = `local-${Date.now()}`;
    const optimisticAttachments: ChatAttachmentDTO[] = filesToSend.map((f, i) => ({
      id: `local-file-${i}`,
      fileName: f.name,
      mimeType: f.type || "application/octet-stream",
      url: "#",
      sizeBytes: f.size,
    }));
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: "user",
        content: text,
        attachments: optimisticAttachments.length > 0 ? optimisticAttachments : undefined,
      },
    ]);

    const modelForSend = selectedModelRef.current.trim();
    let res: Response;
    if (filesToSend.length > 0) {
      const form = new FormData();
      form.append("content", text);
      form.append("skills", JSON.stringify([]));
      if (isHostedChatRuntime(agent?.runtime) && modelForSend.length > 0) {
        form.append("model", modelForSend);
      }
      if (canUseBrain && useBrain) {
        form.append("useBrain", "true");
      }
      for (const file of filesToSend) {
        form.append("files", file);
      }
      res = await fetch(
        `${base}/api/v1/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          credentials: "include",
          body: form,
        },
      );
    } else {
      const payload: Record<string, unknown> = { content: text, skills: [] };
      if (isHostedChatRuntime(agent?.runtime) && modelForSend.length > 0) {
        payload.model = modelForSend;
      }
      if (canUseBrain && useBrain) {
        payload.useBrain = true;
      }
      res = await fetch(
        `${base}/api/v1/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
    }
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
          const pending = await listPendingJit(conversationId, agentId);
          if (pending.length > 0) {
            setMessages((prev) => mergePendingJitIntoMessages(prev, pending));
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
            "The agent run failed. Check the system line in the thread for the error details.",
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

  /** Latest unresolved JIT request across the thread (for sticky composer banner). */
  const stickyJitPending = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role !== "agent" || !m.activity) continue;
      const step = getPendingJitStep(m.activity);
      if (step) return step;
    }
    return null;
  }, [messages]);

  const runnerStatus = agent ? deriveAgentDisplayStatus(agent) : null;
  const statusHint = runnerStatus ? agentStatusHint(runnerStatus, agent?.runtime) : null;
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
      <SketchBox className="relative flex h-full min-h-[min(520px,70dvh)] flex-col items-center justify-center overflow-hidden p-4 text-center sm:min-h-[520px] sm:p-8">
        <Link
          href={backHref}
          className={cn(
            sketchButtonGhost,
            "group absolute left-3 top-3 inline-flex items-center gap-1.5 normal-case tracking-normal",
          )}
        >
          <ArrowLeft className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden />
          Back to agents
        </Link>
        <div className="qlix-empty-glow flex size-14 items-center justify-center rounded-2xl border border-black/12 bg-[var(--sketch-tint-purple)]">
          <Brain className="size-7 text-black" aria-hidden />
        </div>
        <div className="mt-4 space-y-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-black">{agent.name}</h2>
          {runnerStatus ? <SketchStatusBadge status={runnerStatus} /> : null}
          <p className="max-w-sm text-[13px] leading-relaxed text-black/55">
            The org AI brain answers knowledge queries on the AI Brain page — it does not use a chat agent.
          </p>
        </div>
        {aiBrainHref ? (
          <Link href={aiBrainHref} className={cn(sketchButtonPrimary, "mt-4 gap-2")}>
            Open AI Brain
          </Link>
        ) : null}
      </SketchBox>
    );
  }

  return (
    <SketchBox tone="blue" className="relative flex h-full min-h-[min(520px,70dvh)] flex-col overflow-hidden sm:min-h-[520px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className={cn("border-b border-black/10 px-3 py-2.5 sm:px-4", sketchToneBg.blue)}>
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={backHref}
              className={cn(
                sketchButtonGhost,
                "group inline-flex shrink-0 items-center gap-1 px-2 py-1 normal-case tracking-normal",
              )}
            >
              <ArrowLeft className="size-3 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden />
              <span className="hidden sm:inline">Back</span>
            </Link>
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-xl border border-black/10",
                sketchToneBg.amber,
              )}
            >
              <Bot className="size-4 text-black" aria-hidden />
            </div>
            <h2 className="min-w-0 shrink truncate text-[13px] font-semibold tracking-tight text-black">
              {header}
            </h2>
            {agent ? (
              <>
                {runnerStatus ? <SketchStatusBadge status={runnerStatus} /> : null}
                <span
                  className={cn(
                    sketchLabel,
                    "shrink-0 rounded-full border border-black/8 px-2 py-0.5 text-[10px] capitalize",
                    sketchToneBg.green,
                  )}
                >
                  {agent.runtime}
                </span>
                {activeModelLabel ? (
                  <span
                    className={cn(
                      "hidden max-w-[180px] shrink items-center gap-1 rounded-full border border-black/8 px-2 py-0.5 sm:inline-flex",
                      sketchToneBg.purple,
                    )}
                    title={`Default: ${agent.model}`}
                  >
                    <Sparkles className="size-2.5 shrink-0 text-black/40" aria-hidden />
                    <span className="truncate font-mono text-[10px] text-black/60">
                      {activeModelLabel}
                    </span>
                  </span>
                ) : null}
              </>
            ) : null}
            {agent && runnerDegraded && statusHint ? (
              <p
                className={cn(
                  "hidden min-w-0 flex-1 truncate rounded-full border border-black/8 px-2.5 py-1 text-[10px] text-black/60 md:block",
                  sketchToneBg.amber,
                )}
                role="status"
                title={statusHint}
              >
                {statusHint}
              </p>
            ) : (
              <div className="min-w-0 flex-1" />
            )}
            <button
              type="button"
              onClick={() => void clearChat()}
              disabled={!conversationId || clearing || sending || messages.length === 0}
              className={cn(sketchButtonDanger, "shrink-0 gap-1.5")}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {clearing ? "Clearing…" : "Clear"}
            </button>
          </div>
        </div>

        {showBrowserLive ? (
          <div className="border-b border-black lg:hidden">
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
            className={cn(
              "thin-scrollbar min-h-0 flex-1 overflow-y-scroll px-3 py-3 sm:px-5 sm:py-5 [scrollbar-gutter:stable]",
              sketchToneBg.default,
            )}
          >
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-black/50">
              <Loader2 className="size-8 animate-spin text-[color:var(--sketch-purple)]" aria-hidden />
              <p className="font-serif text-[12px] uppercase tracking-widest">Opening conversation…</p>
            </div>
          ) : error ? (
            <p
              className={cn(
                "qlix-msg-in border border-black px-3 py-2 text-[12px] text-black",
                sketchToneBg.rose,
              )}
            >
              {error}
            </p>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
                  <div className="qlix-empty-glow flex size-16 items-center justify-center border border-black bg-[var(--sketch-tint-blue)]">
                    <MessageSquare className="size-8 text-black" aria-hidden />
                  </div>
                  <div
                    className={cn(
                      "qlix-msg-in max-w-sm space-y-2 border border-black px-4 py-3",
                      sketchToneBg.green,
                    )}
                  >
                    <p className="text-[15px] font-semibold tracking-tight text-black">Start a conversation</p>
                    <p className="text-[13px] leading-relaxed text-black/55">
                      Messages stream in real time while your agent processes your request. Activity steps appear above
                      each reply when the backend reports them.
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((m, msgIndex) => {
                  const isLast = m.id === messages[messages.length - 1]?.id;
                  const thisStreaming = sending && m.role === "agent" && isLast;
                  // Show approval UI whenever a request is outstanding — not only while
                  // the SSE stream is open (hybrid runs often pause for JIT after logs land).
                  const jitPendingStep = m.activity ? getPendingJitStep(m.activity) : null;
                  return (
                  <div
                    key={m.id}
                    className={cn(
                      "qlix-msg-in flex gap-3",
                      m.role === "user" ? "flex-row-reverse" : "flex-row",
                      m.role === "system" && "justify-center",
                    )}
                    style={{ "--qlix-stagger-i": Math.min(msgIndex, 8) } as React.CSSProperties}
                  >
                    {m.role !== "system" ? (
                      <div
                        className={cn(
                          "mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border border-black/10 transition-transform duration-300",
                          m.role === "user"
                            ? cn("text-black", sketchToneBg.purple)
                            : cn("text-black", sketchToneBg.blue),
                        )}
                        aria-hidden
                      >
                        {m.role === "user" ? (
                          <UserRound className="size-3.5" />
                        ) : (
                          <Bot className="size-3.5" />
                        )}
                      </div>
                    ) : null}

                    <div
                      className={cn(
                        "min-w-0 max-w-[min(100%,32rem)] rounded-2xl border border-black/10 px-4 py-3.5 text-[13px] leading-relaxed shadow-[var(--sketch-shadow)] transition-shadow duration-300",
                        m.role === "user" && sketchToneBg.purple,
                        m.role === "agent" && sketchToneBg.blue,
                        m.role === "system" &&
                          cn(
                            "max-w-full rounded-full px-3 py-1.5 text-center text-[12px] text-black/55 shadow-none",
                            sketchToneBg.green,
                          ),
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
                        <div
                          role="status"
                          aria-live="polite"
                          className={cn(
                            "mb-3 rounded-xl border-2 border-amber-700/40 px-3 py-3 shadow-[inset_3px_0_0_rgb(180,83,9)]",
                            sketchToneBg.amber,
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <ShieldCheck
                              className="mt-0.5 size-4 shrink-0 text-amber-900"
                              aria-hidden
                            />
                            <div className="min-w-0 text-[12px] leading-snug text-black">
                              <span className="font-semibold tracking-tight">
                                {jitPendingStep.label}
                              </span>
                              {jitPendingStep.detail ? (
                                <span className="mt-0.5 block text-[11px] text-black/65">
                                  {jitPendingStep.detail}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          {jitPendingStep.jitWhatsappExpected ? (
                            <p className="mt-2 rounded-lg border border-amber-800/35 bg-white/45 px-2 py-1.5 text-[11px] font-medium leading-snug text-amber-950">
                              {jitPendingStep.jitWhatsappStatus === "not_linked"
                                ? "Your WhatsApp isn't connected, so this couldn't be sent to your phone. Connect it in Connectors — or just approve below."
                                : "Your WhatsApp isn't connected right now, so this couldn't be sent to your phone. Reconnect it in Connectors — or just approve below."}
                            </p>
                          ) : null}
                          {jitPendingStep.jitRequestId ? (
                            <>
                              <div className="mt-2.5 flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={Boolean(jitDeciding[jitPendingStep.jitRequestId])}
                                  onClick={() => handleJitDecision(jitPendingStep.jitRequestId!, true)}
                                  className={cn(sketchButtonPrimary, "gap-1 disabled:opacity-50")}
                                >
                                  {jitDeciding[jitPendingStep.jitRequestId] ? (
                                    <Loader2 className="size-3 animate-spin" aria-hidden />
                                  ) : null}
                                  Approve
                                  {jitPendingStep.jitScope === "email.send" ||
                                  jitPendingStep.jitScope === "social.publish" ||
                                  jitPendingStep.jitScope === "crm.write" ||
                                  jitPendingStep.jitScope === "crm.delete" ||
                                  jitPendingStep.jitScope === "whatsapp.contact_send"
                                    ? " for this chat"
                                    : ""}
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(jitDeciding[jitPendingStep.jitRequestId])}
                                  onClick={() => handleJitDecision(jitPendingStep.jitRequestId!, false)}
                                  className={cn(sketchButtonSecondary, "gap-1 disabled:opacity-50")}
                                >
                                  Deny
                                </button>
                              </div>
                              {jitPendingStep.jitChannel === "whatsapp" ? (
                                <p className="mt-2 text-[11px] font-medium text-black/60">
                                  Or reply Approve or Deny on WhatsApp.
                                </p>
                              ) : null}
                            </>
                          ) : jitPendingStep.jitChannel === "whatsapp" ? (
                            <p className="mt-2 text-[11px] font-medium text-black/70">
                              Reply Approve or Deny on WhatsApp to continue.
                            </p>
                          ) : null}
                          {jitError ? (
                            <p className="mt-1.5 text-[10px] text-black">{jitError}</p>
                          ) : null}
                        </div>
                      ) : null}
                      {m.role === "agent" && (!m.content || m.content.trim() === "") && lastAgentStreaming && m.id === messages[messages.length - 1]?.id ? (
                        <div className="flex items-center gap-2 py-1 text-black/50">
                          <span className="relative flex size-2.5 items-center justify-center" aria-hidden>
                            <span className="qlix-orb-ping absolute inline-flex size-2.5 rounded-full bg-[color:var(--sketch-purple)]/50" />
                            <span className="qlix-orb-core relative inline-flex size-1.5 rounded-full bg-[color:var(--sketch-purple)]" />
                          </span>
                          <span className={cn("qlix-text-shimmer", sketchLabel)}>Thinking…</span>
                        </div>
                      ) : m.role === "agent" ? (
                        <AgentMessageContent
                          content={m.content}
                          completed={!thisStreaming}
                          activity={m.activity}
                        />
                      ) : (
                        <>
                          {m.content.trim() ? (
                            <div className="whitespace-pre-wrap text-[13px]">{renderWithLinks(m.content)}</div>
                          ) : null}
                          {m.attachments && m.attachments.length > 0 ? (
                            <MessageAttachments attachments={m.attachments} />
                          ) : null}
                        </>
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

        <div className="relative z-10 shrink-0 overflow-visible border-t border-black/8 px-3 py-3 sm:px-5 sm:py-4">
          <div className="mx-auto w-full max-w-3xl overflow-visible">
            {stickyJitPending ? (
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  "mb-3 rounded-xl border-2 border-amber-700/45 px-3 py-3 shadow-[0_8px_24px_-12px_rgba(180,83,9,0.45)]",
                  sketchToneBg.amber,
                )}
              >
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-900" aria-hidden />
                  <div className="min-w-0 flex-1 text-[12px] leading-snug text-black">
                    <p className="font-semibold tracking-tight">{stickyJitPending.label}</p>
                    {stickyJitPending.detail ? (
                      <p className="mt-0.5 text-[11px] text-black/65">{stickyJitPending.detail}</p>
                    ) : null}
                  </div>
                </div>
                {stickyJitPending.jitWhatsappExpected ? (
                  <p className="mt-2 rounded-lg border border-amber-800/35 bg-white/45 px-2 py-1.5 text-[11px] font-medium leading-snug text-amber-950">
                    {stickyJitPending.jitWhatsappStatus === "not_linked"
                      ? "Your WhatsApp isn't connected, so this couldn't be sent to your phone. Connect it in Connectors — or just approve below."
                      : "Your WhatsApp isn't connected right now, so this couldn't be sent to your phone. Reconnect it in Connectors — or just approve below."}
                  </p>
                ) : null}
                {stickyJitPending.jitRequestId ? (
                  <>
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={Boolean(jitDeciding[stickyJitPending.jitRequestId])}
                        onClick={() => handleJitDecision(stickyJitPending.jitRequestId!, true)}
                        className={cn(sketchButtonPrimary, "gap-1 disabled:opacity-50")}
                      >
                        {jitDeciding[stickyJitPending.jitRequestId] ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden />
                        ) : null}
                        Approve
                        {stickyJitPending.jitScope === "email.send" ||
                        stickyJitPending.jitScope === "social.publish" ||
                        stickyJitPending.jitScope === "crm.write" ||
                        stickyJitPending.jitScope === "crm.delete" ||
                        stickyJitPending.jitScope === "whatsapp.contact_send"
                          ? " for this chat"
                          : ""}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(jitDeciding[stickyJitPending.jitRequestId])}
                        onClick={() => handleJitDecision(stickyJitPending.jitRequestId!, false)}
                        className={cn(sketchButtonSecondary, "gap-1 disabled:opacity-50")}
                      >
                        Deny
                      </button>
                    </div>
                    {stickyJitPending.jitChannel === "whatsapp" ? (
                      <p className="mt-2 text-[11px] font-medium text-black/60">
                        Or reply Approve or Deny on WhatsApp.
                      </p>
                    ) : null}
                  </>
                ) : stickyJitPending.jitChannel === "whatsapp" ? (
                  <p className="mt-2 text-[11px] font-medium text-black/70">
                    Reply Approve or Deny on WhatsApp to continue.
                  </p>
                ) : null}
                {jitError ? <p className="mt-1.5 text-[10px] text-black">{jitError}</p> : null}
              </div>
            ) : null}
            {fileError ? (
              <p className={cn("mb-2 rounded-lg border border-black px-3 py-2 text-[12px] text-black", sketchToneBg.rose)}>
                {fileError}
              </p>
            ) : null}
            {pendingFiles.length > 0 ? (
              <ul className="mb-2 flex flex-wrap gap-1.5">
                {pendingFiles.map((f, i) => (
                  <li
                    key={`${f.name}-${f.size}-${i}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-black/12 bg-white/90 px-2.5 py-1 text-[11px] text-black/70"
                  >
                    <FileText className="size-3 shrink-0" aria-hidden />
                    <span className="truncate max-w-[10rem]">{f.name}</span>
                    <span className="shrink-0 text-black/40">{formatFileSize(f.size)}</span>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => {
                        setPendingFiles((prev) => prev.filter((_, idx) => idx !== i));
                        setFileError(null);
                      }}
                      className="ml-0.5 shrink-0 rounded-full p-0.5 text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:opacity-40"
                      title="Remove file"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="chat-composer relative flex items-end gap-2 overflow-visible rounded-[1.35rem] border border-black/12 bg-white/85 p-2 shadow-[0_-4px_28px_-14px_rgba(17,12,34,0.1)] backdrop-blur-xl">
              <input
                ref={fileInputRef}
                key={fileInputKey}
                type="file"
                multiple
                accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.html,.xml"
                className="sr-only"
                disabled={!conversationId || sending || pendingFiles.length >= CHAT_MAX_FILES}
                onChange={(e) => {
                  addPendingFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={!conversationId || sending || pendingFiles.length >= CHAT_MAX_FILES}
                onClick={() => fileInputRef.current?.click()}
                title={
                  pendingFiles.length >= CHAT_MAX_FILES
                    ? `Maximum ${CHAT_MAX_FILES} files`
                    : "Attach files (up to 8, max 50 MB each)"
                }
                className="sketch-press flex size-10 shrink-0 items-center justify-center rounded-full border border-black/12 bg-white text-black/55 transition-all duration-200 hover:border-black/25 hover:text-black disabled:opacity-30"
              >
                <Paperclip className="size-4" aria-hidden />
              </button>
              <div className="flex min-w-0 flex-1 flex-col">
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
                  className={cn(
                    "max-h-[180px] w-full resize-none border-0 bg-transparent px-3 py-2.5 text-[14px] leading-snug text-black outline-none transition-[min-height,opacity] duration-200 placeholder:text-black/30 disabled:opacity-60",
                    input ? "min-h-[72px] sm:min-h-[44px]" : "min-h-[44px]",
                  )}
                />
                {isHostedChatRuntime(agent?.runtime) ? (
                  catalogLoading ? (
                    <span className="inline-flex items-center gap-1 px-3 pb-1 text-[10px] text-black/40">
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                      Loading models…
                    </span>
                  ) : (
                    <ModelHierarchyPicker
                      value={selectedQlixModelId}
                      groups={pickerGroups}
                      agentDefaultId={agentDefaultModelId}
                      enabledProviders={
                        new Set([agent?.llmProvider ?? "exora"] as Array<"exora" | "openrouter">)
                      }
                      size="compact"
                      placement="above"
                      disabled={!conversationId || sending}
                      onChange={(v) => {
                        setSelectedQlixModelId(v);
                        selectedModelRef.current = v;
                      }}
                    />
                  )
                ) : null}
              </div>
              {sending ? (
                <>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!conversationId || input.trim().length === 0}
                    title="Steer the active run (inject guidance)"
                    className="sketch-press flex size-10 shrink-0 items-center justify-center rounded-full border border-black/90 bg-white text-black transition-transform duration-200 hover:scale-[1.03] disabled:opacity-30"
                  >
                    <SendHorizonal className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void stopRun()}
                    title="Stop the current execution"
                    className="sketch-press flex size-10 shrink-0 items-center justify-center rounded-full border border-black/90 bg-black text-white transition-transform duration-200 hover:scale-[1.03]"
                  >
                    <Square className="size-3.5 fill-current" aria-hidden />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={
                    !conversationId ||
                    (input.trim().length === 0 && pendingFiles.length === 0) ||
                    (isHostedChatRuntime(agent?.runtime) && selectedQlixModelId.trim().length === 0)
                  }
                  title="Send (Enter · Shift+Enter for newline)"
                  className="sketch-press flex size-10 shrink-0 items-center justify-center rounded-full border border-black/90 bg-black text-white transition-all duration-200 hover:border-[color:var(--sketch-purple)] hover:bg-[color:var(--sketch-purple)] hover:scale-[1.03] disabled:opacity-30 disabled:hover:scale-100 disabled:hover:border-black/90 disabled:hover:bg-black"
                >
                  <SendHorizonal className="size-3.5" aria-hidden />
                </button>
              )}
            </div>
            {isHostedChatRuntime(agent?.runtime) && catalogError ? (
              <p className="mt-1.5 text-[10px] text-black/45">{catalogError}</p>
            ) : null}
            {isHostedChatRuntime(agent?.runtime) &&
            agent &&
            new Set(agent.permissionScopes).has("web.research") &&
            /mini|haiku|flash|nano|-8b|small/i.test(selectedQlixModelId || agent.model || "") ? (
              <p className="mt-1.5 text-[10px] text-amber-700">
                Tip: research is more accurate with a stronger model — smaller models may skip
                research and guess. Choose a more capable model above.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {selectedImage ? (
        <div
          className="qlix-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-[2px]"
          onClick={() => setSelectedImage(null)}
          onKeyDown={(e) => e.key === "Escape" && setSelectedImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="qlix-scale-in relative flex h-full max-h-[90vh] max-w-4xl items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${selectedImage.mime || "image/png"};base64,${selectedImage.imageBase64}`}
              alt={selectedImage.label}
              className="max-h-full max-w-full border border-white object-contain"
            />
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className={`${sketchButton} absolute right-4 top-4 size-10 p-0`}
              title="Close fullscreen"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {selectedImage.label && (
              <div className="absolute bottom-4 left-4 border border-white bg-white px-3 py-2 text-sm text-black">
                <p className="font-medium">{selectedImage.label}</p>
                <p className="text-xs text-black/60">{selectedImage.tool}</p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </SketchBox>
  );
}
