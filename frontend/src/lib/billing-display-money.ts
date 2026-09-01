/**
 * Currency display — amounts from API are INR unless noted as USD (OpenRouter COGS).
 * Toggle INR ↔ USD using a live FX rate from GET /api/v1/billing/fx.
 */

export type DisplayCurrency = 'INR' | 'USD';

function parseAmount(input: string | number): number {
  const n = typeof input === 'number' ? input : Number(input);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Format an INR amount string from the API for dashboard display. */
export function formatBillingMoney(inrAmountString: string): string {
  return formatMoney(inrAmountString, 'INR');
}

/** Format a raw number as INR. */
export function formatInr(amount: number): string {
  return amount.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });
}

/** Format a USD amount string (e.g. from OpenRouter inference costs stored in RunUsage). */
export function formatUsd(usdAmountString: string): string {
  const n = Number(usdAmountString);
  if (!Number.isFinite(n)) return `$${usdAmountString}`;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  });
}

export function formatMoney(
  amount: string | number,
  currency: DisplayCurrency,
  options?: { maximumFractionDigits?: number },
): string {
  const n = parseAmount(amount);
  if (!Number.isFinite(n)) return String(amount);
  const digits = options?.maximumFractionDigits ?? (currency === 'USD' ? 4 : 2);
  if (currency === 'USD') {
    return n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: digits,
    });
  }
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: digits,
  });
}

/** Convert INR list price → USD using INR-per-USD rate. */
export function inrToUsd(inr: number, inrPerUsd: number): number {
  if (!(inrPerUsd > 0)) return 0;
  return inr / inrPerUsd;
}

/** Convert USD COGS → INR. */
export function usdToInr(usd: number, inrPerUsd: number): number {
  return usd * inrPerUsd;
}

export function formatInrAsCurrency(
  inrAmount: string | number,
  currency: DisplayCurrency,
  inrPerUsd: number,
): string {
  const inr = parseAmount(inrAmount);
  if (!Number.isFinite(inr)) return String(inrAmount);
  if (currency === 'INR') return formatMoney(inr, 'INR');
  return formatMoney(inrToUsd(inr, inrPerUsd), 'USD', { maximumFractionDigits: 2 });
}

export function formatUsdAsCurrency(
  usdAmount: string | number,
  currency: DisplayCurrency,
  inrPerUsd: number,
): string {
  const usd = parseAmount(usdAmount);
  if (!Number.isFinite(usd)) return String(usdAmount);
  if (currency === 'USD') return formatMoney(usd, 'USD');
  return formatMoney(usdToInr(usd, inrPerUsd), 'INR');
}

export type UsageDisplayCurrency = DisplayCurrency;

const configuredUsdInrRate = Number(process.env.NEXT_PUBLIC_BILLING_USD_INR_RATE ?? "83");
export const USD_INR_DISPLAY_RATE =
  Number.isFinite(configuredUsdInrRate) && configuredUsdInrRate > 0 ? configuredUsdInrRate : 83;

/** Convert OpenRouter's USD inference cost for display without changing stored billing data. */
export function formatUsageCost(usdAmount: string | number, currency: UsageDisplayCurrency): string {
  const amount = Number(usdAmount);
  if (!Number.isFinite(amount)) return currency === "USD" ? `$${usdAmount}` : `₹${usdAmount}`;
  if (currency === "INR") {
    return (amount * USD_INR_DISPLAY_RATE).toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 4,
    });
  }
  return formatUsd(String(amount));
}

/** Keep tiny per-run provider charges visible instead of rounding them to zero. */
export function formatDetailedUsageCost(
  usdAmount: string | number,
  currency: UsageDisplayCurrency,
): string {
  const usd = Number(usdAmount);
  if (!Number.isFinite(usd)) return currency === "USD" ? `$${usdAmount}` : `₹${usdAmount}`;
  const amount = currency === "USD" ? usd : usd * USD_INR_DISPLAY_RATE;
  const maximumFractionDigits = amount !== 0 && Math.abs(amount) < 0.01 ? 8 : 4;
  return amount.toLocaleString(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: amount !== 0 && Math.abs(amount) < 0.01 ? 6 : 2,
    maximumFractionDigits,
  });
}
