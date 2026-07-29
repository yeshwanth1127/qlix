"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";

interface QlixWordmarkProps {
  readonly className?: string;
  /** When true, the wordmark reveals itself with a soft fade/rise on mount. */
  readonly animate?: boolean;
  /** Fired once the reveal animation finishes (only when `animate` is set). */
  readonly onAnimationComplete?: () => void;
  /**
   * @deprecated No longer used — the outline is baked into the Londrina Outline
   * typeface. Kept only so existing call sites don't break.
   */
  readonly strokeWidth?: number;
}

/**
 * "QLIX." brand wordmark, set in the Londrina Outline typeface (loaded via
 * next/font in the root layout and exposed as the `--font-brand` CSS variable).
 * The hollow / outline letterforms come from the font itself, so the glyphs
 * follow the current text colour. Size it with a `text-*` utility on
 * `className`; colour with a `text-*` colour utility.
 */
export function QlixWordmark({ className, animate = false, onAnimationComplete }: QlixWordmarkProps) {
  return (
    <motion.span
      role="img"
      aria-label="Qlix"
      className={cn(
        "inline-block select-none whitespace-nowrap leading-none tracking-[0.04em] [font-family:var(--font-brand)]",
        className,
      )}
      // Londrina Outline is single-weight, so we thicken the outline with a
      // font-size-relative text-stroke to give the wordmark a bold presence.
      style={{ WebkitTextStroke: "0.025em currentColor" }}
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      onAnimationComplete={animate ? onAnimationComplete : undefined}
    >
      QLIX
      {/* The period is the brand's orange accent, independent of the wordmark colour. */}
      <span className="text-[#f97316]" style={{ WebkitTextStroke: "0.025em #f97316" }}>
        .
      </span>
    </motion.span>
  );
}
