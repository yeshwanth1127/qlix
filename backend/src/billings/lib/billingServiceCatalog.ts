/**
 * Maps legacy ingest `eventType` values to canonical billing service keys
 * defined in `billing_services` (e.g. passport, audit).
 */
const LEGACY_EVENT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  passport_verify: 'passport',
  log_entry: 'audit',
  trial_complete: 'audit',
};

export function canonicalBillingServiceKey(eventType: string): string {
  return LEGACY_EVENT_TYPE_ALIASES[eventType] ?? eventType;
}
