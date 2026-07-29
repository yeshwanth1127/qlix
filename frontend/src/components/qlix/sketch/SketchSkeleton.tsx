import { cn } from "@/lib/utils/cn";
import { sketchBorder, sketchToneBg } from "./tokens";

interface SketchSkeletonProps {
  readonly className?: string;
}

export function SketchSkeleton({ className }: SketchSkeletonProps) {
  return <div className={cn("sketch-skeleton", className)} aria-hidden />;
}

/** Page-load placeholder matching SketchMetric proportions. */
export function SketchMetricSkeleton({ className }: SketchSkeletonProps) {
  return (
    <div
      className={cn(
        sketchBorder,
        "sketch-card flex flex-col items-center justify-center gap-3 p-6",
        sketchToneBg.default,
        className,
      )}
      aria-hidden
    >
      <SketchSkeleton className="h-14 w-20 rounded-lg" />
      <SketchSkeleton className="h-3 w-24 rounded-full" />
    </div>
  );
}

/** Compact list-row placeholder. */
export function SketchRowSkeleton({ className }: SketchSkeletonProps) {
  return (
    <div
      className={cn(
        sketchBorder,
        "flex min-h-[2.5rem] items-center justify-between gap-3 px-3 py-2",
        sketchToneBg.default,
        className,
      )}
      aria-hidden
    >
      <SketchSkeleton className="h-3 max-w-[12rem] flex-1 rounded-full" />
      <SketchSkeleton className="h-3 w-16 shrink-0 rounded-full" />
    </div>
  );
}

/** Stack of metric + rows for overview / list loading. */
export function SketchPageSkeleton({
  metrics = 1,
  rows = 5,
  className,
}: {
  readonly metrics?: number;
  readonly rows?: number;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5", className)} role="status" aria-label="Loading">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-4">
          {Array.from({ length: metrics }, (_, i) => (
            <SketchMetricSkeleton key={`m-${i}`} />
          ))}
          <div className="flex flex-col gap-2">
            <SketchSkeleton className="mb-1 h-3 w-20 rounded-full" />
            {Array.from({ length: Math.min(rows, 4) }, (_, i) => (
              <SketchRowSkeleton key={`lr-${i}`} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:col-span-8">
          <SketchSkeleton className="mb-1 h-3 w-28 rounded-full" />
          {Array.from({ length: rows }, (_, i) => (
            <SketchRowSkeleton key={`rr-${i}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Compact table/list skeleton for audit and split views. */
export function SketchListSkeleton({
  rows = 8,
  className,
}: {
  readonly rows?: number;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} role="status" aria-label="Loading">
      <SketchSkeleton className="mb-2 h-9 w-full rounded-2xl" />
      {Array.from({ length: rows }, (_, i) => (
        <SketchRowSkeleton key={i} />
      ))}
    </div>
  );
}
