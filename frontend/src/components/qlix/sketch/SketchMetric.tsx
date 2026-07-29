import { cn } from "@/lib/utils/cn";
import { sketchBorder, sketchLabel, sketchToneBg, type SketchTone } from "./tokens";

interface SketchMetricProps {
  readonly value: string | number;
  readonly label: string;
  readonly className?: string;
  readonly tone?: SketchTone;
}

export function SketchMetric({ value, label, className, tone = "default" }: SketchMetricProps) {
  return (
    <div
      className={cn(
        sketchBorder,
        "sketch-card sketch-card-hover flex flex-col items-center justify-center px-6 py-7",
        sketchToneBg[tone],
        className,
      )}
    >
      <span
        className="text-[52px] font-light leading-none tracking-tight tabular-nums text-black"
        style={{ WebkitTextStroke: "1.1px #0e0d12", color: "transparent" }}
        aria-hidden
      >
        {value}
      </span>
      <span className="sr-only">{value}</span>
      <span className={cn(sketchLabel, "mt-3.5 text-center")}>{label}</span>
    </div>
  );
}
