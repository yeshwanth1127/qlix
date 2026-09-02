export const BRAIN_DOCUMENT_REVIEW_STATUSES = ['pending', 'reviewed', 'rejected'] as const;
export type BrainDocumentReviewStatus = typeof BRAIN_DOCUMENT_REVIEW_STATUSES[number];

export const DEFAULT_REVIEW_FRESHNESS_DAYS = 365;

export function isBrainDocumentReviewStatus(value: string): value is BrainDocumentReviewStatus {
  return (BRAIN_DOCUMENT_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function defaultFreshnessExpiresAt(from: Date = new Date()): Date {
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + DEFAULT_REVIEW_FRESHNESS_DAYS);
  return expires;
}

export function isDocumentFresh(freshnessExpiresAt: Date | null | undefined, now = new Date()): boolean {
  if (!freshnessExpiresAt) return true;
  return freshnessExpiresAt.getTime() > now.getTime();
}
