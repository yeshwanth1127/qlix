import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { sketchBorder, sketchToneBg, type SketchTone } from "./tokens";

interface SketchBoxProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly as?: "div" | "section";
  readonly tone?: SketchTone;
}

export function SketchBox({
  children,
  className,
  as: Tag = "div",
  tone = "default",
}: SketchBoxProps) {
  return (
    <Tag className={cn(sketchBorder, "sketch-card", sketchToneBg[tone], className)}>
      {children}
    </Tag>
  );
}
