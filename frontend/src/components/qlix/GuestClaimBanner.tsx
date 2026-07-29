"use client";

import { useState } from "react";
import { useSession } from "./session-context";
import { ClaimAccountModal } from "./ClaimAccountModal";
import { sketchButton } from "./sketch/tokens";

export function GuestClaimBanner() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);

  if (!session?.user.isGuest) return null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-black/10 bg-white/60 px-4 py-2.5 backdrop-blur-sm">
        <span className="font-serif text-[11px] uppercase tracking-widest text-black">
          Guest workspace
        </span>
        <span className="text-[12px] text-black/60">
          Create a free account to keep your agents and history.
        </span>
        <button type="button" onClick={() => setOpen(true)} className={`${sketchButton} ml-auto`}>
          Save my account
        </button>
      </div>
      <ClaimAccountModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
