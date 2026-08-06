import { cn } from "@/lib/utils/cn";
import type { UsageDisplayCurrency } from "@/lib/billing-display-money";

export function UsageCurrencyToggle({
  value,
  onChange,
}: {
  value: UsageDisplayCurrency;
  onChange: (currency: UsageDisplayCurrency) => void;
}) {
  return (
    <div className="inline-flex self-start border border-black bg-white" aria-label="Display currency">
      {(["USD", "INR"] as const).map((currency) => (
        <button
          key={currency}
          type="button"
          aria-pressed={value === currency}
          onClick={() => onChange(currency)}
          className={cn(
            "px-3 py-1.5 font-serif text-[10px] uppercase tracking-widest transition-colors",
            value === currency ? "bg-black text-white" : "text-black hover:bg-black/5",
          )}
        >
          {currency}
        </button>
      ))}
    </div>
  );
}
