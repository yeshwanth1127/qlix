"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { sketchButton } from "@/components/qlix/sketch";

export function CopyTextButton({
  value,
  label = "Copy",
  className = "",
}: {
  readonly value: string;
  readonly label?: string;
  readonly className?: string;
}) {
  const [ok, setOk] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setOk(true);
      window.setTimeout(() => setOk(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className={`${sketchButton} inline-flex items-center gap-1.5 ${className}`}
      title={label}
      aria-label={label}
    >
      {ok ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span>{ok ? "Copied" : label}</span>
    </button>
  );
}
