"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, SendHorizonal } from "lucide-react";
import {
  confirmGtmSetupProposal,
  queryGtmExa,
  rejectGtmSetupProposal,
  resolveGtmDiscoveryProposal,
  type GtmDiscoveryProposal,
  type GtmQueryCitation,
  type GtmSetup,
  type GtmSetupProposal,
} from "@/lib/gtm-api";

type ChatTurn = {
  id: string;
  role: "user" | "exa";
  content: string;
  citations?: readonly GtmQueryCitation[];
  error?: boolean;
};

function fieldLabel(field: string): string {
  switch (field) {
    case "companyDescription":
      return "Company and positioning";
    case "idealCustomerProfile":
      return "ICP and disqualifiers";
    case "primaryOffer":
      return "Primary offer";
    case "targetRegions":
      return "Target regions";
    case "buyerRolesAndWorkflows":
      return "Buyers and workflows";
    case "proofAndCaseStudies":
      return "Proof and case studies";
    case "validityPolicy":
      return "Information validity policy";
    case "calibrationNotes":
      return "Known-account calibration";
    default:
      return field;
  }
}

function formatValue(value: string | readonly string[]): string {
  if (typeof value === "string") return value;
  return value.join(", ");
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function GtmExaChat({
  setup,
  onSetupChange,
  onProposalChange,
  onDiscoveryChange,
}: {
  readonly setup: GtmSetup | null;
  readonly onSetupChange: (setup: GtmSetup) => void;
  readonly onProposalChange?: (proposals: readonly GtmSetupProposal[]) => void;
  readonly onDiscoveryChange?: () => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [activeProposal, setActiveProposal] = useState<GtmSetupProposal | null>(null);
  const [activeDiscoveryProposal, setActiveDiscoveryProposal] = useState<GtmDiscoveryProposal | null>(null);
  const [resolving, setResolving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || sending) return;
    setInput("");
    setTurns((prev) => [...prev, { id: newId(), role: "user", content: question }]);
    setSending(true);
    const res = await queryGtmExa(question);
    setSending(false);
    if (!res.ok) {
      setTurns((prev) => [...prev, { id: newId(), role: "exa", content: res.message, error: true }]);
      return;
    }
    setTurns((prev) => [
      ...prev,
      {
        id: newId(),
        role: "exa",
        content: res.data.answer,
        citations: res.data.citations,
      },
    ]);
    if (res.data.setupProposal) {
      setActiveProposal(res.data.setupProposal);
      onProposalChange?.([res.data.setupProposal]);
    }
    if (res.data.discoveryProposal) setActiveDiscoveryProposal(res.data.discoveryProposal);
    queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" }));
  }, [input, onProposalChange, sending]);

  async function resolveProposal(action: "confirm" | "reject") {
    if (!activeProposal) return;
    setResolving(true);
    const result = action === "confirm"
      ? await confirmGtmSetupProposal(activeProposal.id)
      : await rejectGtmSetupProposal(activeProposal.id);
    setResolving(false);
    if (!result.ok) {
      setTurns((prev) => [...prev, { id: newId(), role: "exa", content: result.message, error: true }]);
      return;
    }
    onSetupChange(result.setup);
    setActiveProposal(null);
    onProposalChange?.([]);
    setTurns((prev) => [
      ...prev,
      {
        id: newId(),
        role: "exa",
        content: action === "confirm"
          ? "Confirmed. Those setup fields are now saved as operator-approved configuration."
          : "Rejected. No setup fields were changed.",
      },
    ]);
  }

  async function resolveDiscoveryProposal(action: "confirm" | "reject") {
    if (!activeDiscoveryProposal) return;
    setResolving(true);
    const result = await resolveGtmDiscoveryProposal(activeDiscoveryProposal.id, action);
    setResolving(false);
    if (!result.ok) {
      setTurns((prev) => [...prev, { id: newId(), role: "exa", content: result.message, error: true }]);
      return;
    }
    setActiveDiscoveryProposal(null);
    onDiscoveryChange?.();
    setTurns((prev) => [...prev, {
      id: newId(), role: "exa",
      content: action === "confirm" ? "Confirmed. The discovery register now includes this item." : "Discarded. Discovery truth was not changed.",
    }]);
  }

  return (
    <div className="flex min-h-[20rem] flex-col">
      <div ref={scrollRef} className="mb-3 max-h-[min(28rem,50vh)] space-y-3 overflow-y-auto pr-1">
        {turns.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-black/50">
            Ask Exa about your reviewed GTM knowledge. Answers use only reviewed, fresh documents from GTM Brain collections.
          </p>
        ) : null}
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={turn.role === "user" ? "border border-black/15 bg-black/[0.03] px-3 py-2" : "px-1 py-1"}
          >
            <p className="mb-1 font-serif text-[9px] uppercase tracking-widest text-black/40">
              {turn.role === "user" ? "You" : "Exa"}
            </p>
            <p className={turn.error ? "text-[12px] text-[#8b1e12]" : "text-[12px] leading-relaxed text-black/80"}>
              {turn.content}
            </p>
            {turn.citations && turn.citations.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[11px] text-black/45">
                {turn.citations.slice(0, 3).map((citation, index) => (
                  <li key={`${citation.documentId}-${citation.chunkOrdinal}`}>
                    [{index + 1}] {citation.documentTitle} · {citation.collectionName}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        {sending ? (
          <div className="flex items-center gap-2 text-[12px] text-black/45">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Exa is thinking…
          </div>
        ) : null}
      </div>

      {activeProposal ? (
        <div className="mb-3 border border-black bg-[#f7f4ea] p-3">
          <p className="font-serif text-[10px] uppercase tracking-widest text-black/50">Setup proposal</p>
          <p className="mt-1 text-[12px] leading-relaxed text-black/70">{activeProposal.rationale}</p>
          <div className="mt-3 space-y-2">
            {activeProposal.diff.map((entry) => (
              <div key={entry.field} className="border-t border-black/10 pt-2 first:border-0 first:pt-0">
                <p className="font-serif text-[9px] uppercase tracking-widest text-black/45">{fieldLabel(entry.field)}</p>
                <p className="mt-1 text-[11px] text-black/40 line-through">{formatValue(entry.before) || "—"}</p>
                <p className="text-[12px] text-black">{formatValue(entry.after)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={resolving}
              onClick={() => void resolveProposal("confirm")}
              className="border border-black bg-black px-3 py-1.5 font-serif text-[10px] uppercase tracking-widest text-white disabled:opacity-50"
            >
              Confirm changes
            </button>
            <button
              type="button"
              disabled={resolving}
              onClick={() => void resolveProposal("reject")}
              className="border border-black px-3 py-1.5 font-serif text-[10px] uppercase tracking-widest disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      ) : null}

      {activeDiscoveryProposal ? (
        <div className="mb-3 border border-black bg-[#f6f1df] p-3">
          <p className="font-serif text-[10px] uppercase tracking-widest text-black/50">
            {activeDiscoveryProposal.kind === "idea" ? "Starting idea proposal" : "Hypothesis proposal"}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-black/70">{activeDiscoveryProposal.rationale}</p>
          <p className="mt-2 border-t border-black/10 pt-2 text-[13px] leading-relaxed">
            {String(activeDiscoveryProposal.payload.idea ?? activeDiscoveryProposal.payload.statement ?? "")}
          </p>
          {activeDiscoveryProposal.kind === "hypothesis" ? (
            <p className="mt-2 text-[9px] uppercase tracking-wider text-black/45">
              {String(activeDiscoveryProposal.payload.kind ?? "hypothesis").replaceAll("_", " ")} · {String(activeDiscoveryProposal.payload.evidenceClass ?? "unknown").replaceAll("_", " ")}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={resolving} onClick={() => void resolveDiscoveryProposal("confirm")} className="border border-black bg-black px-3 py-1.5 font-serif text-[10px] uppercase tracking-widest text-white disabled:opacity-50">Confirm</button>
            <button type="button" disabled={resolving} onClick={() => void resolveDiscoveryProposal("reject")} className="border border-black px-3 py-1.5 font-serif text-[10px] uppercase tracking-widest disabled:opacity-50">Discard</button>
          </div>
        </div>
      ) : null}

      <div className="flex items-end gap-2 border border-black/25 bg-white p-2">
        <textarea
          rows={2}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="Tell Exa your idea, uncertainty, or an assumption to test…"
          className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-[13px] text-black outline-none placeholder:text-black/35"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !input.trim()}
          className="flex size-8 shrink-0 items-center justify-center border border-black disabled:opacity-40"
          aria-label="Send"
        >
          <SendHorizonal className="size-3.5" aria-hidden />
        </button>
      </div>
      {setup?.confirmedFields.length ? (
        <p className="mt-2 text-[10px] text-black/40">
          Confirmed: {setup.confirmedFields.map(fieldLabel).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
