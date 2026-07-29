"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, SendHorizonal, Sparkles, X } from "lucide-react";
import Orb from "./Orb";
import {
  getOpenRouterModelCatalog,
  queryAiBrain,
  updateAiBrainModel,
  type AiBrainQueryCitation,
  type OpenRouterCatalogModelOption,
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

/** Curated chat picker — full OpenRouter catalog is too large for a compact select. */
const CHAT_MODEL_PRESETS: readonly { readonly qlixModelId: string; readonly label: string }[] = [
  { qlixModelId: "openrouter/openai/gpt-4o-mini", label: "GPT-4o mini" },
  { qlixModelId: "openrouter/openai/gpt-4o", label: "GPT-4o" },
  { qlixModelId: "openrouter/anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { qlixModelId: "openrouter/google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { qlixModelId: "openrouter/qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B" },
];

interface ChatTurn {
  readonly id: string;
  readonly role: "user" | "brain";
  readonly content: string;
  readonly citations?: readonly AiBrainQueryCitation[];
  readonly error?: boolean;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function shortModelLabel(qlixModelId: string, catalog: readonly OpenRouterCatalogModelOption[]): string {
  const preset = CHAT_MODEL_PRESETS.find((p) => p.qlixModelId === qlixModelId);
  if (preset) return preset.label;
  const hit = catalog.find((m) => m.qlixModelId === qlixModelId || m.id === qlixModelId.replace(/^openrouter\//i, ""));
  if (hit?.name) return hit.name;
  const bare = qlixModelId.replace(/^openrouter\//i, "");
  const parts = bare.split("/");
  return parts[parts.length - 1] || bare;
}

export function BrainOrbChat({
  disabled,
  open: openProp,
  onOpenChange,
  hideLauncher = false,
  defaultModel,
  canPersistModel = false,
  onModelPersisted,
}: {
  readonly disabled?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** Hide the corner FAB when a page-level hero orb already launches chat. */
  readonly hideLauncher?: boolean;
  /** Current org brain query model (qlix canonical id). */
  readonly defaultModel?: string;
  /** Owners/admins can persist the picker choice as the org brain default. */
  readonly canPersistModel?: boolean;
  readonly onModelPersisted?: (model: string) => void;
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
  const [catalog, setCatalog] = useState<readonly OpenRouterCatalogModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState(defaultModel?.trim() || CHAT_MODEL_PRESETS[0]!.qlixModelId);
  const [modelBusy, setModelBusy] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!defaultModel?.trim()) return;
    setSelectedModel(defaultModel.trim());
  }, [defaultModel]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getOpenRouterModelCatalog().then((res) => {
      if (cancelled || !res.ok) return;
      setCatalog(res.models);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
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
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, sending]);

  const modelOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of CHAT_MODEL_PRESETS) {
      byId.set(p.qlixModelId, p.label);
    }
    if (selectedModel && !byId.has(selectedModel)) {
      byId.set(selectedModel, shortModelLabel(selectedModel, catalog));
    }
    if (defaultModel?.trim() && !byId.has(defaultModel.trim())) {
      byId.set(defaultModel.trim(), shortModelLabel(defaultModel.trim(), catalog));
    }
    return [...byId.entries()].map(([qlixModelId, label]) => ({ qlixModelId, label }));
  }, [catalog, defaultModel, selectedModel]);

  const onSelectModel = useCallback(
    async (next: string) => {
      setSelectedModel(next);
      if (!canPersistModel || !next.trim()) return;
      if (next.trim() === defaultModel?.trim()) return;
      setModelBusy(true);
      const res = await updateAiBrainModel(next.trim());
      setModelBusy(false);
      if (res.ok) onModelPersisted?.(res.model);
    },
    [canPersistModel, defaultModel, onModelPersisted],
  );

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || sending) return;
    setInput("");
    setTurns((prev) => [...prev, { id: newId(), role: "user", content: question }]);
    setSending(true);
    const res = await queryAiBrain(question, selectedModel);
    setSending(false);
    if (!res.ok) {
      setTurns((prev) => [...prev, { id: newId(), role: "brain", content: res.message, error: true }]);
      return;
    }
    setTurns((prev) => [
      ...prev,
      { id: newId(), role: "brain", content: res.data.answer, citations: res.data.citations },
    ]);
  }, [input, selectedModel, sending]);

  if (disabled) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
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
            className="flex max-h-[min(480px,calc(100dvh-5.5rem))] h-[min(480px,calc(100dvh-5.5rem))] w-[min(420px,calc(100vw-3rem))] flex-col overflow-hidden border border-black bg-white shadow-[6px_6px_0_rgba(0,0,0,0.12)]"
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
              <button
                type="button"
                aria-label="Close chat"
                onClick={() => setOpen(false)}
                className="flex size-6 items-center justify-center text-black/50 transition-colors hover:text-black"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

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
                      <ul className="mt-2 space-y-1 border-t border-black/10 pt-2">
                        {turn.citations.map((c, i) => (
                          <li key={`${c.documentId}-${c.chunkOrdinal}`} className="text-[10.5px] text-black/50">
                            <span className="font-mono">[{i + 1}]</span> {c.documentTitle}
                            <span className="text-black/35"> · {c.collectionName}</span>
                          </li>
                        ))}
                      </ul>
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
              <div className="flex items-center gap-2">
                <label className="shrink-0 font-serif text-[10px] uppercase tracking-widest text-black/45" htmlFor="exa-chat-model">
                  Model
                </label>
                <select
                  id="exa-chat-model"
                  value={selectedModel}
                  disabled={sending || modelBusy}
                  onChange={(e) => void onSelectModel(e.target.value)}
                  className="min-w-0 flex-1 border border-black bg-white px-2 py-1.5 text-[12px] text-black outline-none focus:shadow-[0_0_0_3px_var(--sketch-purple-soft)] disabled:opacity-40"
                  title={canPersistModel ? "Used for this chat; also saved as exa’s default model" : "Model for this chat"}
                >
                  {modelOptions.map((m) => (
                    <option key={m.qlixModelId} value={m.qlixModelId}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {modelBusy ? <Loader2 className="size-3.5 shrink-0 animate-spin text-black/40" aria-hidden /> : null}
              </div>
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

      {hideLauncher ? null : (
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
