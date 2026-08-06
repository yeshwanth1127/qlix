import { sketchLabel } from "./sketch/tokens";

interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly subtext: string;
}

export function MetricCard({ label, value, subtext }: MetricCardProps) {
  return (
    <div className="sketch-card sketch-card-hover qlix-section-in border border-[color:var(--sketch-card-border,var(--qlix-card-border))] bg-[var(--sketch-tint)] p-5">
      <p className={sketchLabel}>{label}</p>
      <p className="mt-2 font-serif text-[28px] leading-none text-black">{value}</p>
      <p className="mt-2 font-serif text-[10px] uppercase tracking-widest text-black/50">{subtext}</p>
    </div>
  );
}
