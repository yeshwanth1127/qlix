"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, MessageSquarePlus, PanelLeft, SendHorizonal, Sparkles, Trash2, X } from "lucide-react";
import Orb from "./Orb";
import {
  createAiBrainConversation,
  deleteAiBrainConversation,
  getAiBrainConversationMessages,
  getAiBrainConversations,
  queryAiBrain,
  type AiBrainConversationRow,
  type AiBrainQueryCitation,
} from "@/lib/ai-brain-api";
import { sketchButton } from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";

/**
 * Shown to the user as the brain's opening line. The model-facing system prompt
 * (identity, "answer only from retrieved context", citation rules) lives server-side
 * in backend/src/aiBrain/brainQuery.service.ts so it can't be bypassed from the client.
 */
const GREETING =
  "Hi, I'm exa. Ask me anything about your company's knowledge base — I'll answer from what's been indexed here and cite my sources.";

interface ChatTurn {
  readonly id: string;
  readonly role: "user" | "brain";
  readonly content: string;
  readonly citations?: readonly AiBrainQueryCitation[];
  readonly error?: boolean;
}

function SourcesPopover({ citations }: { readonly citations: readonly AiBrainQueryCitation[] }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const visible = hovered || focused || pinned;
  const uniqueCitations = Array.from(
    new Map(citations.map((citation) => [`${citation.collectionId}:${citation.documentId}`, citation])).values(),
  );

  return (
    <div
      className="relative mt-2 inline-flex border-t border-black/10 pt-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setPinned(false);
          setHovered(false);
          (event.currentTarget.querySelector("button") as HTMLButtonElement | null)?.focus();
        }
      }}
    >
      <button
        type="button"
        aria-expanded={visible}
        onClick={() => setPinned((current) => !current)}
        className="font-serif text-[10px] uppercase tracking-[0.12em] text-black/50 underline decoration-black/20 underline-offset-4 transition-colors hover:text-black focus-visible:text-black focus-visible:outline-none"
      >
        Sources ({uniqueCitations.length})
      </button>

      <AnimatePresence>
        {visible ? (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            role="tooltip"
            className="absolute bottom-full left-0 z-30 mb-2 w-[min(20rem,72vw)] rounded-lg border border-black bg-white p-2.5 shadow-[4px_4px_0_rgba(0,0,0,0.12)]"
          >
            <p className="mb-2 font-serif text-[9px] uppercase tracking-[0.14em] text-black/40">
              Sources for this response
            </p>
            <ol className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {uniqueCitations.map((citation, index) => (
                <li
                  key={`${citation.collectionId}-${citation.documentId}`}
                  className="text-[10.5px] leading-snug text-black/60"
                >
                  <span className="font-mono text-black/40">[{index + 1}]</span>{" "}
                  <span className="text-black/70">{citation.documentTitle}</span>
                  <span className="text-black/35"> · {citation.collectionName}</span>
                </li>
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function BrainOrbChat({
  disabled,
  open: openProp,
  onOpenChange,
  hideLauncher = false,
  embedded = false,
}: {
  readonly disabled?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** Hide the corner FAB when a page-level hero orb already launches chat. */
  readonly hideLauncher?: boolean;
  /** Render inside the brain stage instead of as a fixed corner panel. */
  readonly embedded?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(openProp ?? uncontrolledOpen) : next;
      onOpenChange?.(resolved);
      if (openProp === undefined) setUncontrolledOpen(resolved);
    },
    [onOpenChange, openProp, uncontrolledOpen],
  );
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState<readonly AiBrainConversationRow[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationsWithLocalStateRef = useRef(new Set<string>());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => setHistoryLoading(true));
    void getAiBrainConversations().then((res) => {
      if (cancelled) return;
      setHistoryLoading(false);
      if (!res.ok) return;
      setConversations(res.conversations);
      setConversationId((current) => current ?? res.conversations[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !conversationId) {
      if (!conversationId) queueMicrotask(() => setTurns([]));
      return;
    }
    // A newly created conversation is already represented by local turns. Avoid
    // letting its initially empty server history erase the user's first message.
    if (conversationsWithLocalStateRef.current.has(conversationId)) return;
    let cancelled = false;
    queueMicrotask(() => setHistoryLoading(true));
    void getAiBrainConversationMessages(conversationId).then((res) => {
      if (cancelled) return;
      setHistoryLoading(false);
      if (!res.ok) return;
      setTurns(res.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: message.citations,
      })));
    });
    return () => { cancelled = true; };
  }, [conversationId, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!embedded && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [embedded, open, setOpen]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, sending]);

  const startNewChat = useCallback(async () => {
    const res = await createAiBrainConversation();
    if (!res.ok) return null;
    conversationsWithLocalStateRef.current.add(res.conversation.id);
    setConversations((current) => [res.conversation, ...current]);
    setConversationId(res.conversation.id);
    setTurns([]);
    setHistoryOpen(false);
    return res.conversation.id;
  }, []);

  const removeChat = useCallback(async (id: string) => {
    const res = await deleteAiBrainConversation(id);
    if (!res.ok) return;
    setConversations((current) => {
      const remaining = current.filter((conversation) => conversation.id !== id);
      if (conversationId === id) setConversationId(remaining[0]?.id ?? null);
      return remaining;
    });
  }, [conversationId]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || sending) return;
    const activeConversationId = conversationId ?? await startNewChat();
    if (!activeConversationId) return;
    setInput("");
    setTurns((prev) => [...prev, { id: newId(), role: "user", content: question }]);
    setSending(true);
    const res = await queryAiBrain(question, activeConversationId);
    conversationsWithLocalStateRef.current.delete(activeConversationId);
    setSending(false);
    if (!res.ok) {
      setTurns((prev) => [...prev, { id: newId(), role: "brain", content: res.message, error: true }]);
      return;
    }
    setTurns((prev) => [
      ...prev,
      { id: newId(), role: "brain", content: res.data.answer, citations: res.data.citations },
    ]);
    const now = new Date().toISOString();
    setConversations((current) => current.map((conversation) =>
      conversation.id === activeConversationId
        ? {
            ...conversation,
            title: conversation.title === "New chat" ? question.replace(/\s+/g, " ").slice(0, 72) : conversation.title,
            updatedAt: now,
            messageCount: conversation.messageCount + 2,
          }
        : conversation,
    ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, [conversationId, input, sending, startNewChat]);

  if (disabled) return null;

  return (
    <div className={cn(embedded ? "flex w-full justify-center" : "fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3")}>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            role="dialog"
            aria-label="Chat with exa"
            className={cn(
              "relative flex flex-col overflow-hidden border border-black bg-white shadow-[6px_6px_0_rgba(0,0,0,0.12)]",
              embedded
                ? "h-[min(520px,68dvh)] w-full max-w-2xl"
                : "h-[min(480px,calc(100dvh-5.5rem))] max-h-[min(480px,calc(100dvh-5.5rem))] w-[min(420px,calc(100vw-3rem))]",
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="size-7 overflow-hidden rounded-full border border-black">
                  <Orb hue={0} hoverIntensity={0.3} rotateOnHover={false} forceHoverState backgroundColor="#ffffff" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="font-serif text-[11px] uppercase tracking-widest text-black">exa</span>
                  <span className="text-[10px] text-black/50">Answers from your knowledge base</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Recent chats" onClick={() => setHistoryOpen(true)} className="flex size-7 items-center justify-center text-black/50 transition-colors hover:text-black">
                  <PanelLeft className="size-4" aria-hidden />
                </button>
                <button type="button" aria-label="New chat" onClick={() => void startNewChat()} className="flex size-7 items-center justify-center text-black/50 transition-colors hover:text-black">
                  <MessageSquarePlus className="size-4" aria-hidden />
                </button>
                <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="flex size-7 items-center justify-center text-black/50 transition-colors hover:text-black">
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </div>

            <AnimatePresence>
              {historyOpen ? (
                <motion.aside
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 z-40 flex w-[min(17rem,82%)] flex-col border-r border-black bg-white shadow-[5px_0_0_rgba(0,0,0,0.08)]"
                  aria-label="Recent chats"
                >
                  <div className="flex items-center justify-between border-b border-black px-3 py-3">
                    <span className="font-serif text-[11px] uppercase tracking-widest text-black">Recent chats</span>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Start a new chat" onClick={() => void startNewChat()} className="flex size-7 items-center justify-center text-black/50 hover:text-black"><MessageSquarePlus className="size-4" aria-hidden /></button>
                      <button type="button" aria-label="Close recent chats" onClick={() => setHistoryOpen(false)} className="flex size-7 items-center justify-center text-black/50 hover:text-black"><X className="size-4" aria-hidden /></button>
                    </div>
                  </div>
                  <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
                    {historyLoading && conversations.length === 0 ? (
                      <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-black/40"><Loader2 className="size-3.5 animate-spin" aria-hidden />Loading chats…</div>
                    ) : conversations.length === 0 ? (
                      <p className="px-2 py-3 text-[11px] text-black/45">No recent chats yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {conversations.map((conversation) => (
                          <div key={conversation.id} className={cn("group flex w-full items-center border transition-colors", conversation.id === conversationId ? "border-black bg-black text-white" : "border-transparent text-black hover:border-black/20 hover:bg-black/[0.03]")}>
                            <button type="button" onClick={() => { setConversationId(conversation.id); setHistoryOpen(false); }} className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[11.5px]">
                              {conversation.title}
                            </button>
                            <button type="button" aria-label={`Delete ${conversation.title}`} onClick={() => void removeChat(conversation.id)} className={cn("mr-1 flex size-6 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100", conversation.id === conversationId ? "text-white/60 hover:text-white" : "text-black/40 hover:text-black")}>
                              <Trash2 className="size-3.5" aria-hidden />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.aside>
              ) : null}
            </AnimatePresence>

            <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
              <div className="flex gap-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-black/40" aria-hidden />
                <p className="text-[12.5px] leading-relaxed text-black/70">{GREETING}</p>
              </div>
              {turns.map((turn) => (
                <div key={turn.id} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed",
                      turn.role === "user"
                        ? "border-black bg-black text-white"
                        : turn.error
                          ? "border-black/20 bg-white text-black/60"
                          : "border-black bg-white text-black",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{turn.content}</p>
                    {turn.citations && turn.citations.length > 0 ? (
                      <SourcesPopover citations={turn.citations} />
                    ) : null}
                  </div>
                </div>
              ))}
              {sending ? (
                <div className="flex items-center gap-2 text-[11px] text-black/40">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Searching your knowledge base…
                </div>
              ) : null}
            </div>

            <div className="flex w-full shrink-0 flex-col gap-2 border-t border-black p-3">
              <div className="flex w-full min-w-0 items-stretch gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask your brain…"
                  rows={2}
                  className="box-border min-h-12 min-w-0 flex-1 resize-none overflow-y-auto border border-black bg-white px-3 py-2 text-[13px] leading-5 text-black outline-none placeholder:text-black/40 focus:shadow-[0_0_0_3px_var(--sketch-purple-soft)]"
                />
                <button
                  type="button"
                  disabled={sending || !input.trim()}
                  onClick={() => void send()}
                  aria-label="Send"
                  className={cn(sketchButton, "min-h-12 shrink-0 self-stretch px-3")}
                >
                  {sending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <SendHorizonal className="size-3.5" aria-hidden />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {hideLauncher || embedded ? null : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close exa chat" : "Chat with exa"}
          aria-expanded={open}
          className="group relative size-16 overflow-hidden rounded-full border border-black bg-white shadow-[3px_3px_0_rgba(0,0,0,0.12)] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
        >
          <Orb hue={0} hoverIntensity={0.5} rotateOnHover forceHoverState={open} backgroundColor="#ffffff" />
          <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center font-serif text-[8px] uppercase tracking-widest text-black/0 transition-colors group-hover:text-black/50">
            {open ? "Close" : "Ask"}
          </span>
        </button>
      )}
    </div>
  );
}
