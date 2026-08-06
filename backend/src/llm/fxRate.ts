/**
 * Live USD→INR FX for billing display. Cached in-process; refreshes periodically.
 */

export interface UsdInrRate {
  readonly rate: number;
  readonly asOf: string;
  readonly source: string;
}

let cached: { value: UsdInrRate; expiresAt: number } | null = null;

const TTL_MS = 60 * 60 * 1000; // 1 hour
const FALLBACK_RATE = 95.4;

async function fetchFrankfurter(): Promise<UsdInrRate | null> {
  const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR', {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { date?: string; rates?: { INR?: number } };
  const rate = body.rates?.INR;
  if (typeof rate !== 'number' || !(rate > 0)) return null;
  return { rate, asOf: body.date ?? new Date().toISOString().slice(0, 10), source: 'frankfurter.app' };
}

async function fetchExchangeRateApi(): Promise<UsdInrRate | null> {
  const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { date?: string; rates?: { INR?: number } };
  const rate = body.rates?.INR;
  if (typeof rate !== 'number' || !(rate > 0)) return null;
  return {
    rate,
    asOf: body.date ?? new Date().toISOString().slice(0, 10),
    source: 'exchangerate-api.com',
  };
}

/** Returns USD→INR mid-market rate (cached). Falls back to last good / static if providers fail. */
export async function getUsdInrRate(options?: { forceRefresh?: boolean }): Promise<UsdInrRate> {
  const now = Date.now();
  if (!options?.forceRefresh && cached && cached.expiresAt > now) {
    return cached.value;
  }

  let value: UsdInrRate | null = null;
  try {
    value = await fetchFrankfurter();
  } catch {
    value = null;
  }
  if (!value) {
    try {
      value = await fetchExchangeRateApi();
    } catch {
      value = null;
    }
  }

  if (!value) {
    if (cached) return cached.value;
    value = {
      rate: FALLBACK_RATE,
      asOf: new Date().toISOString().slice(0, 10),
      source: 'fallback',
    };
  }

  cached = { value, expiresAt: now + TTL_MS };
  return value;
}

export function inrToUsd(inr: number, usdPerInrInverse: number): number {
  if (!(usdPerInrInverse > 0)) return 0;
  return inr / usdPerInrInverse;
}

export function usdToInr(usd: number, inrPerUsd: number): number {
  return usd * inrPerUsd;
}
