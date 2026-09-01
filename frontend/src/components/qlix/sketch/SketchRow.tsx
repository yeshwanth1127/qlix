import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { sketchBorder, sketchToneBg, type SketchTone } from "./tokens";

interface SketchRowProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly onClick?: () => void;
  readonly as?: "div" | "button" | "li";
  readonly tone?: SketchTone;
  readonly style?: CSSProperties;
  /** Highlight as selected (sidebar / list selection language). */
  readonly selected?: boolean;
}

export function SketchRow({
  children,
  className,
  onClick,
  as,
  tone = "default",
  style,
  selected = false,
}: SketchRowProps) {
  const base = cn(
    sketchBorder,
    "min-h-[2.5rem] px-3 py-2 transition-all duration-200 ease-out",
    sketchToneBg[tone],
    selected &&
      "border-[color:var(--sketch-purple)]/40 bg-[color:var(--sketch-purple-soft)] shadow-[inset_3px_0_0_var(--sketch-purple)]",
    className,
  );

  if (as === "button" || onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={style}
        className={cn(
          base,
          "sketch-press w-full text-left hover:border-[color:var(--sketch-purple)]/35 hover:bg-[color:var(--sketch-purple-soft)] hover:shadow-[0_8px_20px_-14px_rgba(16,14,22,0.28)] hover:-translate-y-px",
        )}
      >
        {children}
      </button>
    );
  }

  if (as === "li") {
    return (
      <li className={cn(base, "hover:bg-[#E2F0CC]/90")} style={style}>
        {children}
      </li>
    );
  }

  return (
    <div className={cn(base, "hover:bg-[#E2F0CC]/90")} style={style}>
      {children}
    </div>
  );
}
