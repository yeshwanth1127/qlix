/** Sanitized regression shape matching Pooja's eight artifact_upload records. */
export const POOJA_EIGHT_ARTIFACTS_FIXTURE = {
  sessionId: 'pooja-work-session',
  orgId: 'pooja-org',
  artifactIds: Array.from({ length: 8 }, (_, index) => `pooja-artifact-${index + 1}`),
} as const;
