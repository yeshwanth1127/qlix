import type { ReactNode } from "react";
import { SketchBox, SketchPageHeader } from "./sketch";

interface PlaceholderConsolePageProps {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
}

/** Sketch-styled page shell for console routes. */
export function PlaceholderConsolePage({ title, description, children }: PlaceholderConsolePageProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader title={title} />
      {description ? (
        <p className="mb-4 max-w-xl font-serif text-[11px] uppercase tracking-widest text-black/50">
          {description}
        </p>
      ) : null}
      {children ?? (
        <SketchBox className="flex-1 p-5">
          <p className="font-serif text-[11px] uppercase tracking-widest text-black/40">
            Content area
          </p>
        </SketchBox>
      )}
    </div>
  );
}
