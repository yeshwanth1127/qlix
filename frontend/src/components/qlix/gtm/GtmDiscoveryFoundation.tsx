"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import Stepper, { Step } from "@/components/ui/Stepper";
import {
  createGtmDiscoveryProposal,
  getGtmDiscoveryFoundation,
  resolveGtmDiscoveryProposal,
  type GtmDiscoveryFoundation as Foundation,
  type GtmDiscoveryProposal,
} from "@/lib/gtm-api";

const inputClass = "mt-5 w-full border border-black/25 bg-transparent px-3 py-3 text-[14px] leading-relaxed text-black outline-none placeholder:text-black/35 focus:border-black";

function Question({ number, title, hint, children }: {
  readonly number: number;
  readonly title: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/40">Question {number} of 6</p>
      <h2 className="mt-2 text-2xl font-medium text-black">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-black/50">{hint}</p>
      {children}
    </div>
  );
}

function ReviewCard({ proposal, busy, onResolve }: {
  readonly proposal: GtmDiscoveryProposal;
  readonly busy: boolean;
  readonly onResolve: (decision: "confirm" | "reject") => void;
}) {
  return (
    <div className="mt-4 border border-black bg-[#f6f1df] p-5">
      <p className="font-serif text-[10px] uppercase tracking-widest text-black/45">Confirm your discovery starting point</p>
      <p className="mt-2 text-[14px] leading-relaxed">{String(proposal.payload.idea ?? "")}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={busy} onClick={() => onResolve("confirm")} className="border border-black bg-black px-4 py-2 font-serif text-[10px] uppercase tracking-widest text-white disabled:opacity-40">Confirm</button>
        <button type="button" disabled={busy} onClick={() => onResolve("reject")} className="border border-black px-4 py-2 font-serif text-[10px] uppercase tracking-widest disabled:opacity-40">Go back</button>
      </div>
    </div>
  );
}

export function GtmDiscoveryFoundation({
  refreshKey = 0,
  onConfirmed,
}: {
  readonly refreshKey?: number;
  readonly onConfirmed?: () => void;
}) {
  const router = useRouter();
  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flowKey, setFlowKey] = useState(0);
  const [flowComplete, setFlowComplete] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [idea, setIdea] = useState("");
  const [problem, setProblem] = useState("");
  const [audience, setAudience] = useState("");
  const [solution, setSolution] = useState("");
  const [outcome, setOutcome] = useState("");
  const [constraints, setConstraints] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getGtmDiscoveryFoundation().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) { setError(result.message); return; }
      setFoundation(result.foundation);
      const content = result.foundation.idea?.content;
      if (content) {
        setIdea(content.idea); setProblem(content.problem); setAudience(content.audience);
        setSolution(content.solution); setOutcome(content.outcome); setConstraints(content.constraints);
        setFlowComplete(result.foundation.proposals.every((proposal) => proposal.kind !== "idea"));
      }
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const pendingIdea = useMemo(
    () => foundation?.proposals.find((proposal) => proposal.kind === "idea") ?? null,
    [foundation],
  );

  async function finishQuestions(): Promise<boolean> {
    setBusy(true); setError(null);
    const result = await createGtmDiscoveryProposal({
      kind: "idea",
      rationale: foundation?.idea ? "Update the discovery answers" : "Set the discovery starting point",
      payload: { idea, problem, audience, solution, outcome, constraints },
    });
    setBusy(false);
    if (!result.ok) { setError(result.message); return false; }
    setFoundation((current) => current ? { ...current, proposals: [result.proposal, ...current.proposals] } : current);
    return true;
  }

  async function resolve(decision: "confirm" | "reject") {
    if (!pendingIdea) return;
    setBusy(true); setError(null);
    const result = await resolveGtmDiscoveryProposal(pendingIdea.id, decision);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setFoundation(result.foundation);
    if (decision === "confirm") {
      onConfirmed?.();
      router.push("/organization/gtm");
      return;
    }
    setFlowComplete(false);
    setCurrentStep(1);
    setFlowKey((value) => value + 1);
  }

  if (loading) return <p className="py-10 text-center text-[13px] text-black/45">Loading discovery questions…</p>;

  if (flowComplete && !pendingIdea) {
    return (
      <div className="mx-auto w-full max-w-3xl border border-black/25 bg-[#fbfaf6] p-8 text-center">
        <Check className="mx-auto size-5" aria-hidden />
        <h2 className="mt-3 text-xl font-medium">Discovery starting point saved</h2>
        <p className="mt-2 text-[12px] text-black/50">Open your GTM workspace or edit your answers.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/organization/gtm" className="border border-black bg-black px-4 py-2 font-serif text-[10px] uppercase tracking-widest text-white">Open workspace</Link>
          <button type="button" onClick={() => { setFlowComplete(false); setFlowKey((value) => value + 1); }} className="border border-black px-4 py-2 font-serif text-[10px] uppercase tracking-widest">Edit answers</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {error ? <p className="mb-3 border border-black bg-[#f4d7cf] px-3 py-2 text-[12px]" role="alert">{error}</p> : null}
      {!pendingIdea ? (
        <Stepper
          key={flowKey}
          initialStep={1}
          disableStepIndicators
          onStepChange={setCurrentStep}
          onFinalStepCompleted={finishQuestions}
          nextButtonProps={{ disabled: currentStep === 1 && !idea.trim() }}
        >
          <Step><Question number={1} title="What is your business idea?" hint="One clear sentence is enough."><textarea autoFocus rows={4} value={idea} onChange={(event) => setIdea(event.target.value)} className={inputClass} placeholder="We help…" /></Question></Step>
          <Step><Question number={2} title="What problem do you believe exists?" hint="Leave this blank if you are not sure yet."><textarea rows={4} value={problem} onChange={(event) => setProblem(event.target.value)} className={inputClass} placeholder="The problem might be…" /></Question></Step>
          <Step><Question number={3} title="Who might experience this problem?" hint="A broad answer is fine at this stage."><textarea rows={4} value={audience} onChange={(event) => setAudience(event.target.value)} className={inputClass} placeholder="Teams, roles, or types of companies…" /></Question></Step>
          <Step><Question number={4} title="How might you solve it?" hint="Describe the approach, not a finished product specification."><textarea rows={4} value={solution} onChange={(event) => setSolution(event.target.value)} className={inputClass} placeholder="Our approach would…" /></Question></Step>
          <Step><Question number={5} title="What should improve if it works?" hint="Think about a practical business or user outcome."><textarea rows={4} value={outcome} onChange={(event) => setOutcome(event.target.value)} className={inputClass} placeholder="Customers should be able to…" /></Question></Step>
          <Step>
            <Question number={6} title="Any important constraints?" hint="Add geography, pricing, runway, delivery, legal, or language limits. Then review your answers.">
              <textarea rows={3} value={constraints} onChange={(event) => setConstraints(event.target.value)} className={inputClass} placeholder="Optional constraints…" />
              <dl className="mt-5 grid gap-2 border-t border-black/15 pt-4 text-[12px] sm:grid-cols-2">
                <div><dt className="text-black/40">Idea</dt><dd className="mt-1">{idea || "Unknown"}</dd></div>
                <div><dt className="text-black/40">Problem</dt><dd className="mt-1">{problem || "Unknown"}</dd></div>
                <div><dt className="text-black/40">Customer</dt><dd className="mt-1">{audience || "Unknown"}</dd></div>
                <div><dt className="text-black/40">Outcome</dt><dd className="mt-1">{outcome || "Unknown"}</dd></div>
              </dl>
            </Question>
          </Step>
        </Stepper>
      ) : null}
      {pendingIdea ? <ReviewCard proposal={pendingIdea} busy={busy} onResolve={(decision) => void resolve(decision)} /> : null}
    </div>
  );
}
