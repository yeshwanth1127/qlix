"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copy a DID (or any value) to the clipboard with a transient check confirmation. */
export function CopyDidButton({ value, label = "DID" }: { readonly value: string; readonly label?: string }) {
  const [ok, setOk] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setOk(true);
      window.setTimeout(() => setOk(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="qlix-glass-muted inline-flex size-7 items-center justify-center rounded-md text-[--text-tertiary] transition-colors hover:bg-[var(--glass-surface-bg-hover)] hover:text-[--text-primary]"
      title={`Copy ${label}`}
      aria-label={`Copy ${label === "DID" ? "decentralized identifier" : label}`}
    >
      {ok ? <Check className="size-[14px] text-green-500" aria-hidden /> : <Copy className="size-[14px]" aria-hidden />}
    </button>
  );
}
