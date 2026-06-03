export type ActionRiskLevel = 'low' | 'medium' | 'high';

/**
 * The exact object the SDK signs for /api/v1/actions/start.
 * The signature in the request body is over canonicalize(signedPayload).
 */
export interface StartSignedPayload {
  did: string;
  actionType: string;
  timestampMs: number;
  riskLevel?: ActionRiskLevel;
  /** Optional opaque metadata (parameters, target URL, etc.). */
  metadata?: Record<string, unknown>;
  /** Optional client-generated nonce for replay defence. */
  nonce?: string;
  /** One-time token from GET /api/v1/jit/poll after human approval (required when actionType is in agent.jitScopes). */
  jitToken?: string;
}

/**
 * The exact object the SDK signs for /api/v1/actions/complete.
 */
export interface CompleteSignedPayload {
  did: string;
  actionId: string;
  success: boolean;
  timestampMs: number;
  /** Drives wallet pricing if provided; falls back to the start row's actionType. */
  eventType?: string;
  /** Idempotency key for the SuccessfulEvent debit; defaults to actionId. */
  eventKey?: string;
  result?: Record<string, unknown>;
  errorMessage?: string;
  errorCode?: string;
}
