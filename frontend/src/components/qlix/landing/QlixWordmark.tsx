"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";

interface QlixWordmarkProps {
  readonly className?: string;
  /** Keeps the supplied artwork legible when it sits on a dark surface. */
  readonly surface?: "light" | "dark";
  /** When true, the wordmark reveals itself with a soft fade/rise on mount. */
  readonly animate?: boolean;
  /** Fired once the reveal animation finishes (only when `animate` is set). */
  readonly onAnimationComplete?: () => void;
  /** @deprecated Kept only so existing call sites don't break. */
  readonly strokeWidth?: number;
}

export function QlixWordmark({
  className,
  surface = "light",
  animate = false,
  onAnimationComplete,
}: QlixWordmarkProps) {
  return (
    <motion.span
      role="img"
      aria-label="Qlix"
      className={cn(
        "inline-flex h-[1.3em] select-none items-center leading-none",
        className,
      )}
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      onAnimationComplete={animate ? onAnimationComplete : undefined}
    >
      <Image
        src={surface === "dark" ? "/qlix-logo-green-dark.png" : "/qlix-logo-green.png"}
        alt=""
        width={1585}
        height={559}
        draggable={false}
        className="block h-full w-auto max-w-none object-contain"
      />
    </motion.span>
  );
}
