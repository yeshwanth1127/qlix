/**
 * Check if a user is exempt from all billing deductions and balance checks.
 * Exempted users still have usage recorded but no wallet is debited.
 *
 * Exact-match allowlist only. A previous `startsWith('y@exora.com')` check let any address whose
 * local part/domain merely began with that string (e.g. `y@exora.com.attacker.tld`) bypass billing.
 * Configure via BILLING_EXEMPT_EMAILS (comma-separated); falls back to the internal ops account.
 */
function exemptEmails(): Set<string> {
  const configured = (process.env.BILLING_EXEMPT_EMAILS ?? 'y@exora.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(configured);
}

export function isBillingExempt(email: string): boolean {
  return exemptEmails().has(email.trim().toLowerCase());
}
