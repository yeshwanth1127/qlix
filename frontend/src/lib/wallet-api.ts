const apiBase = () => process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export interface WalletBalanceResponse {
  balance: string;
  currency: string;
  billingCycle: string;
  monthToDate: {
    spend: string;
    successfulEvents: number;
  };
}

export interface WalletTransaction {
  id: string;
  type: string;
  amount: string;
  status: string;
  createdAt: string;
}

export async function getWalletBalance(): Promise<WalletBalanceResponse | null> {
  const base = await apiBase();
  try {
    const res = await fetch(`${base}/api/v1/wallet/balance`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    return (await res.json()) as WalletBalanceResponse;
  } catch {
    return null;
  }
}

export async function getWalletTransactions(): Promise<WalletTransaction[] | null> {
  const base = await apiBase();
  try {
    const res = await fetch(`${base}/api/v1/wallet/transactions`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { transactions: WalletTransaction[] };
    return body.transactions;
  } catch {
    return null;
  }
}
