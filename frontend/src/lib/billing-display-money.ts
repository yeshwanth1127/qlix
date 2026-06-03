export type BillingDisplayCurrency = "usd" | "inr";

const STORAGE_KEY = "qlix.billing.displayCurrency";

/** Indicative rate for UI only; wallet and API remain USD. */
function usdToInrRate(): number {
  const raw = process.env.NEXT_PUBLIC_BILLING_USD_INR_RATE;
  if (raw?.trim()) {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 83;
}

export function getBillingUsdInrDisplayRate(): number {
  return usdToInrRate();
}

export function readStoredBillingDisplayCurrency(): BillingDisplayCurrency | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "inr" || v === "usd" ? v : null;
}

export function persistBillingDisplayCurrency(currency: BillingDisplayCurrency): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, currency);
}

function parseUsdAmount(input: string): number {
  const n = Number(input);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Format a USD-denominated numeric string from the API for dashboard display.
 */
export function formatBillingMoney(usdAmountString: string, display: BillingDisplayCurrency): string {
  const usd = parseUsdAmount(usdAmountString);
  if (!Number.isFinite(usd)) {
    return display === "usd" ? `$${usdAmountString}` : `₹${usdAmountString}`;
  }
  if (display === "usd") {
    return usd.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 4,
    });
  }
  const inr = usd * usdToInrRate();
  return inr.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}
