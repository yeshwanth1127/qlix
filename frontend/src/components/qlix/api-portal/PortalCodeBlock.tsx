"use client";

import { CopyTextButton } from "@/components/qlix/api-keys/CopyTextButton";
import type { PortalVariant } from "./portalTheme";

export function PortalCodeBlock({
  code,
  copyLabel = "Copy",
  variant = "console",
}: {
  readonly code: string;
  readonly copyLabel?: string;
  readonly variant?: PortalVariant;
}) {
  const preClass =
    variant === "docs"
      ? "overflow-x-auto rounded-lg bg-[#012F13]/[0.06] p-3 pr-24 font-mono text-[11px] leading-relaxed text-[#012F13]/90 whitespace-pre-wrap break-all"
      : "overflow-x-auto rounded-lg bg-black/[0.04] p-3 pr-24 font-mono text-[11px] leading-relaxed text-black/85 whitespace-pre-wrap break-all";

  return (
    <div className="relative">
      <pre className={preClass}>{code}</pre>
      <div className="absolute right-2 top-2">
        <CopyTextButton value={code} label={copyLabel} />
      </div>
    </div>
  );
}
