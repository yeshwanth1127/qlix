"use client";

import { GitBranch, Link2, Mail, MessageCircle, NotebookText, Share2, Users } from "lucide-react";
import type { RequiredConnectorInfo } from "@/lib/required-connectors";
import type { ConnectorProvider } from "@/lib/connectors-api";
import { sketchButtonPrimary, sketchButtonSecondary, sketchLabel } from "@/components/qlix/sketch";

const PROVIDER_ICON: Record<ConnectorProvider, React.ReactNode> = {
  google: <Mail className="size-3.5" aria-hidden />,
  zoho: <Users className="size-3.5" aria-hidden />,
  whatsapp_baileys: <MessageCircle className="size-3.5" aria-hidden />,
  orbit: <Share2 className="size-3.5" aria-hidden />,
  slack: <MessageCircle className="size-3.5" aria-hidden />,
  discord: <MessageCircle className="size-3.5" aria-hidden />,
  github: <GitBranch className="size-3.5" aria-hidden />,
  telegram: <MessageCircle className="size-3.5" aria-hidden />,
  microsoft: <Mail className="size-3.5" aria-hidden />,
  notion: <NotebookText className="size-3.5" aria-hidden />,
};

interface RequiredConnectorsPopupProps {
  readonly open: boolean;
  readonly connectors: readonly RequiredConnectorInfo[];
  readonly busy?: boolean;
  readonly onConnectNow: () => void;
  readonly onConnectLater: () => void;
  readonly onDismiss: () => void;
}

/**
 * Shown before AI Builder creates an agent when the plan needs connectors
 * that are not linked yet. Connect now → create then open Connectors;
 * connect later → create and stay in the builder.
 */
export function RequiredConnectorsPopup({
  open,
  connectors,
  busy = false,
  onConnectNow,
  onConnectLater,
  onDismiss,
}: RequiredConnectorsPopupProps) {
  if (!open || connectors.length === 0) return null;

  const plural = connectors.length > 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="required-connectors-title"
      onClick={() => {
        if (!busy) onDismiss();
      }}
    >
      <div
        className="relative w-full max-w-sm border-2 border-black bg-[#E2F0CC] shadow-[4px_4px_0_0_#000]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-black px-4 py-3">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 shrink-0" aria-hidden />
            <h2 id="required-connectors-title" className={sketchLabel}>
              Connect {plural ? "these platforms" : "this platform"}
            </h2>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-black/55">
            You&apos;ll need to connect {plural ? "these" : "this"} for the agent to work properly.
            You can do it now or after creation.
          </p>
        </div>

        <ul className="space-y-2.5 px-4 py-3">
          {connectors.map((c) => (
            <li key={c.provider} className="flex gap-2.5">
              <span
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center border border-black bg-black/5 text-black"
                aria-hidden
              >
                {PROVIDER_ICON[c.provider]}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-black">{c.name}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-black/60">{c.description}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 border-t border-black px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onConnectNow}
            className={`${sketchButtonPrimary} w-full justify-center`}
          >
            Connect now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConnectLater}
            className={`${sketchButtonSecondary} w-full justify-center`}
          >
            Connect later
          </button>
        </div>
      </div>
    </div>
  );
}
