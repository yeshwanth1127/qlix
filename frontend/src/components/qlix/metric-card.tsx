import { ReflectiveCard } from "./ReflectiveCard";

interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly subtext: string;
}

export function MetricCard({ label, value, subtext }: MetricCardProps) {
  return (
    <ReflectiveCard className="rounded-xl" contentClassName="flex flex-col gap-1 p-5">
      <p className="text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
        {label}
      </p>
      <p className="text-[28px] font-medium tracking-[-0.03em] text-[--text-primary]">{value}</p>
      <p className="text-[12px] text-[--text-tertiary]">{subtext}</p>
    </ReflectiveCard>
  );
}
