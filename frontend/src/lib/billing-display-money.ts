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
