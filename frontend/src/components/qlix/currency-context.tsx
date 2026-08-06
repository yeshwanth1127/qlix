'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { DisplayCurrency } from '@/lib/billing-display-money';
import { formatInrAsCurrency, formatUsdAsCurrency } from '@/lib/billing-display-money';

type FxState = {
  rate: number;
  asOf: string;
  source: string;
};

type CurrencyContextValue = {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
  toggleCurrency: () => void;
  fx: FxState | null;
  fxLoading: boolean;
  formatInr: (inrAmount: string | number) => string;
  formatUsdCogs: (usdAmount: string | number) => string;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

const STORAGE_KEY = 'qlix:displayCurrency';

async function fetchFx(): Promise<FxState> {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const res = await fetch(`${base}/api/v1/billing/fx`, { credentials: 'include' });
  if (!res.ok) throw new Error('fx_failed');
  const body = (await res.json()) as { rate: number; asOf: string; source: string };
  return { rate: body.rate, asOf: body.asOf, source: body.source };
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>('INR');
  const [fx, setFx] = useState<FxState | null>(null);
  const [fxLoading, setFxLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'USD' || raw === 'INR') setCurrencyState(raw);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFxLoading(true);
    void fetchFx()
      .then((v) => {
        if (!cancelled) setFx(v);
      })
      .catch(() => {
        if (!cancelled) setFx({ rate: 95.4, asOf: new Date().toISOString().slice(0, 10), source: 'fallback' });
      })
      .finally(() => {
        if (!cancelled) setFxLoading(false);
      });
    const id = window.setInterval(() => {
      void fetchFx()
        .then((v) => {
          if (!cancelled) setFx(v);
        })
        .catch(() => undefined);
    }, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const setCurrency = useCallback((c: DisplayCurrency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCurrency = useCallback(() => {
    setCurrency(currency === 'INR' ? 'USD' : 'INR');
  }, [currency, setCurrency]);

  const rate = fx?.rate ?? 95.4;

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency,
      toggleCurrency,
      fx,
      fxLoading,
      formatInr: (inrAmount) => formatInrAsCurrency(inrAmount, currency, rate),
      formatUsdCogs: (usdAmount) => formatUsdAsCurrency(usdAmount, currency, rate),
    }),
    [currency, setCurrency, toggleCurrency, fx, fxLoading, rate],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useDisplayCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    const rate = 95.4;
    return {
      currency: 'INR',
      setCurrency: () => undefined,
      toggleCurrency: () => undefined,
      fx: null,
      fxLoading: false,
      formatInr: (inr) => formatInrAsCurrency(inr, 'INR', rate),
      formatUsdCogs: (usd) => formatUsdAsCurrency(usd, 'USD', rate),
    };
  }
  return ctx;
}

/** Compact INR | USD toggle control. */
export function CurrencyToggle({ className }: { className?: string }) {
  const { currency, setCurrency, fx } = useDisplayCurrency();
  return (
    <div className={className}>
      <div className="inline-flex border border-black/20 text-[11px]">
        <button
          type="button"
          className={`px-2 py-1 ${currency === 'INR' ? 'bg-black text-white' : 'text-black/60'}`}
          onClick={() => setCurrency('INR')}
        >
          INR
        </button>
        <button
          type="button"
          className={`px-2 py-1 ${currency === 'USD' ? 'bg-black text-white' : 'text-black/60'}`}
          onClick={() => setCurrency('USD')}
        >
          USD
        </button>
      </div>
      {fx ? (
        <p className="mt-1 text-[10px] text-black/40">
          1 USD = ₹{fx.rate.toFixed(2)} · {fx.asOf} · {fx.source}
        </p>
      ) : null}
    </div>
  );
}
