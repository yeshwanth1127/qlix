/**
 * Check if a user is exempt from all billing deductions and balance checks.
 * Exempted users still have usage recorded but no wallet is debited.
 */
export function isBillingExempt(email: string): boolean {
  return email.startsWith('y@exora.solutions');
}
