/**
 * All wallet and billing amounts are stored and returned from the API in INR.
 * No conversion needed — just format for display.
 */

function parseAmount(input: string): number {
  const n = Number(input);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Format an INR amount string from the API for dashboard display. */
export function formatBillingMoney(inrAmountString: string): string {
  const amount = parseAmount(inrAmountString);
  if (!Number.isFinite(amount)) {
    return `₹${inrAmountString}`;
  }
  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

/** Format a raw number as INR. */
export function formatInr(amount: number): string {
  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

/** Format a USD amount string (e.g. from OpenRouter inference costs stored in RunUsage). */
export function formatUsd(usdAmountString: string): string {
  const n = Number(usdAmountString);
  if (!Number.isFinite(n)) return `$${usdAmountString}`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
}
