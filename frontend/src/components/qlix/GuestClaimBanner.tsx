"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useSession } from "./session-context";
import { ClaimAccountModal } from "./ClaimAccountModal";

/**
 * Slim strip shown across the console while exploring on a guest account.
 * Claiming converts the same user row, so everything built so far is kept.
 */
export function GuestClaimBanner() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);

  if (!session?.user.isGuest) return null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-violet-500/25 bg-gradient-to-r from-violet-600/15 via-indigo-600/10 to-cyan-600/15 px-4 py-2.5">
        <span className="flex items-center gap-2 text-[12px] font-medium text-[--text-primary]">
          <Sparkles className="size-3.5 text-violet-400" aria-hidden />
          You&apos;re exploring as a guest
        </span>
        <span className="text-[12px] text-[--text-tertiary]">
          Create a free account to keep your agents, chats and history.
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:brightness-110"
        >
          Save my account
        </button>
      </div>
      <ClaimAccountModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
