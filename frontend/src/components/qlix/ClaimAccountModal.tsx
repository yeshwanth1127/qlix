"use client";

import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { postClaimAccount } from "@/lib/auth-api";
import { useSession } from "./session-context";
import { cn } from "@/lib/utils/cn";

interface ClaimAccountModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called after the guest account has been converted and the session refreshed. */
  readonly onClaimed?: () => void;
}

/**
 * Converts a guest exploration account into a real account. Everything the
 * guest built (agents, conversations, history) stays — same user row.
 */
export function ClaimAccountModal({ open, onClose, onClaimed }: ClaimAccountModalProps) {
  const { refresh } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async () => {
    if (submitting) return;
    setError(null);
    if (!email.trim() || password.length < 8) {
      setError("Enter a valid email and a password of at least 8 characters");
      return;
    }
    setSubmitting(true);
    const res = await postClaimAccount({
      email: email.trim(),
      password,
      displayName: displayName.trim() || undefined,
    });
    if (!res.ok) {
      setError(res.errorMessage ?? "Could not create your account");
      setSubmitting(false);
      return;
    }
    await refresh();
    setSubmitting(false);
    onClaimed?.();
    onClose();
  };

  return (
    <div className="dark fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0c0a16] p-6 shadow-[0_0_60px_rgba(139,92,246,0.25)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-white/40 transition-colors hover:text-white"
        >
          <X className="size-4" aria-hidden />
        </button>

        <div className="mb-1 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600">
            <Sparkles className="size-4 text-white" aria-hidden />
          </span>
          <h2 className="text-[16px] font-semibold text-white">Keep your work</h2>
        </div>
        <p className="mb-5 text-[12px] leading-relaxed text-white/50">
          Turn this guest workspace into your account. All agents, chats and settings
          you created stay exactly as they are.
        </p>

        <div className="space-y-3">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name (optional)"
            className="w-full rounded-lg border border-white/10 bg-[#E2F0CC]/5 px-3.5 py-2.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/30 focus:border-violet-500/60"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-white/10 bg-[#E2F0CC]/5 px-3.5 py-2.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/30 focus:border-violet-500/60"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 characters)"
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            className="w-full rounded-lg border border-white/10 bg-[#E2F0CC]/5 px-3.5 py-2.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/30 focus:border-violet-500/60"
          />
        </div>

        {error && (
          <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit()}
          className={cn(
            "mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white",
            "bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 shadow-lg shadow-violet-500/25",
            "hover:brightness-110 active:scale-[0.99] motion-safe:transition-[filter,transform]",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {submitting ? "Creating your account…" : "Create my account"}
        </button>
      </div>
    </div>
  );
}
