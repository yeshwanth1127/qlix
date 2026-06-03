import { ReflectiveCard } from "./ReflectiveCard";

interface PlaceholderConsolePageProps {
  readonly title: string;
  readonly description?: string;
}

/** Temporary stub until feature routes are implemented. */
export function PlaceholderConsolePage({ title, description }: PlaceholderConsolePageProps) {
  return (
    <div className="animate-qlix-fade-in">
      <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">{title}</h1>
      {description ? (
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[--text-secondary]">
          {description}
        </p>
      ) : null}
      <ReflectiveCard className="mt-8 rounded" contentClassName="p-5">
        <p className="text-[13px] text-[--text-tertiary]">
          This section will connect to the Qlix API when backend routes are wired.
        </p>
      </ReflectiveCard>
    </div>
  );
}
