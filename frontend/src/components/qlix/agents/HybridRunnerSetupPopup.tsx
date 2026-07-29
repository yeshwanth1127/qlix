"use client";

import { Laptop } from "lucide-react";
import {
  detectHybridClientPlatform,
  type HybridClientPlatform,
} from "@/lib/hybrid-platform";
import { sketchButtonPrimary, sketchLabel } from "@/components/qlix/sketch";

const LAUNCHER_BY_PLATFORM: Record<HybridClientPlatform, string> = {
  windows: "Start Qlix Agent.bat",
  macos: "Start Qlix Agent.command",
  linux: "Start Qlix Agent.sh",
};

const PLATFORM_LABEL: Record<HybridClientPlatform, string> = {
  windows: "Windows",
  macos: "Mac",
  linux: "Linux",
};

interface HybridRunnerSetupPopupProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Optional ZIP filename shown in step 1. */
  readonly zipFilename?: string | null;
}

/**
 * Shown once after a hybrid agent is created — walks the user through
 * unzipping the starter pack and starting the local runner.
 */
export function HybridRunnerSetupPopup({
  open,
  onClose,
  zipFilename,
}: HybridRunnerSetupPopupProps) {
  if (!open) return null;

  const platform = detectHybridClientPlatform();
  const launcher = LAUNCHER_BY_PLATFORM[platform];
  const zipLabel = zipFilename?.trim() || "the starter-pack ZIP";

  const steps = [
    {
      title: "Find the ZIP",
      body: `Check your Downloads folder for ${zipLabel}. If the download was blocked, use the download button on the previous screen.`,
    },
    {
      title: "Unzip the folder",
      body: "Extract the ZIP anywhere on your computer (Desktop, Documents, etc.). Keep the files together — do not move agent.json out of the folder.",
    },
    {
      title: "Start the runner",
      body: `Open the unzipped folder and double-click ${launcher} (${PLATFORM_LABEL[platform]}).`,
    },
    {
      title: "Leave the window open",
      body: "The first launch may take a minute while Python packages install. If prompted, install Python 3.10+ from python.org (on Windows, check \"Add to PATH\"). Keep the terminal/console window open while you use the agent.",
    },
    {
      title: "Return to Qlix",
      body: "Come back to this browser tab. When the agent shows online, you can chat with it from the dashboard.",
    },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hybrid-runner-setup-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm border-2 border-black bg-white shadow-[4px_4px_0_0_#000]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-black px-4 py-3">
          <div className="flex items-center gap-2">
            <Laptop className="size-4 shrink-0" aria-hidden />
            <h2 id="hybrid-runner-setup-title" className={sketchLabel}>
              Connect your hybrid agent
            </h2>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-black/55">
            Your starter pack is ready. Follow these steps to run the agent on your computer.
          </p>
        </div>

        <ol className="space-y-3 px-4 py-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-2.5">
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center border border-black bg-black text-[10px] font-medium text-white"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-black">{step.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-black/60">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="border-t border-black px-4 py-3">
          <button type="button" onClick={onClose} className={`${sketchButtonPrimary} w-full justify-center`}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
