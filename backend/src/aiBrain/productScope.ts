/**
 * Product scope for the Company AI Brain module within Qlix (Exora L3 identity + L5 audit).
 *
 * Default build posture: Tier-1 integrations (identity, gated inference proxy, audit) only.
 * Out of scope unless product re-scopes: L4 connectors (Slack, Google Drive, email ingest, ERP APIs).
 */

export const AI_BRAIN_DEFAULT_SCOPE_L3_L5 = true as const;

export const AI_BRAIN_CONNECTORS_REQUIRE_L4_SCOPE = true as const;
