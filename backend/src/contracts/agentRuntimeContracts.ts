import { z } from 'zod';

export const CAPABILITY_CONTRACT_VERSION = 'qlix.capability.v1' as const;
export const RUNTIME_EVENT_CONTRACT_VERSION = 'qlix.runtime-event.v1' as const;
export const RUNNER_REQUEST_CONTRACT_VERSION = 'qlix.runner-request.v1' as const;
export const RUNNER_RESPONSE_CONTRACT_VERSION = 'qlix.runner-response.v1' as const;

export const SUPPORTED_CONTRACT_VERSIONS = [
  CAPABILITY_CONTRACT_VERSION,
  RUNTIME_EVENT_CONTRACT_VERSION,
  RUNNER_REQUEST_CONTRACT_VERSION,
  RUNNER_RESPONSE_CONTRACT_VERSION,
] as const;

export class ContractVersionError extends Error {
  constructor(offered: readonly string[], supported: readonly string[]) {
    super(`No compatible contract version; offered=${JSON.stringify(offered)}, supported=${JSON.stringify(supported)}`);
    this.name = 'ContractVersionError';
  }
}

export function negotiateContractVersion(
  offered: readonly string[] | undefined,
  supported: readonly string[],
): string | undefined {
  if (offered === undefined) return undefined;
  const supportedSet = new Set(supported);
  const selected = offered.find((version) => supportedSet.has(version));
  if (selected) return selected;
  throw new ContractVersionError(offered, supported);
}

export const capabilityDescriptorSchema = z.strictObject({
  contractVersion: z.literal(CAPABILITY_CONTRACT_VERSION),
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  requiredScopes: z.array(z.string().min(1)),
  scopeMode: z.enum(['all', 'any']),
  jit: z.strictObject({ required: z.boolean(), scopes: z.array(z.string().min(1)) }),
  runtimes: z.array(z.enum(['local', 'cloud', 'hybrid'])).min(1),
  risk: z.strictObject({
    level: z.enum(['low', 'moderate', 'high', 'critical']),
    effects: z.array(z.enum(['read', 'write', 'execute', 'external_communication', 'financial'])),
  }),
  provider: z.strictObject({
    kind: z.enum(['builtin', 'local', 'backend_proxy', 'connector', 'mcp', 'browser']),
    id: z.string().min(1),
  }),
  aliases: z.array(z.string().min(1)).default([]),
});

export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;

export function parseCapabilityDescriptor(value: unknown): CapabilityDescriptor {
  const parsed = capabilityDescriptorSchema.parse(value);
  const uniqueFields: Array<[string, string[]]> = [
    ['requiredScopes', parsed.requiredScopes],
    ['jit.scopes', parsed.jit.scopes],
    ['runtimes', parsed.runtimes],
    ['risk.effects', parsed.risk.effects],
    ['aliases', parsed.aliases],
  ];
  for (const [field, values] of uniqueFields) {
    if (new Set(values).size !== values.length) throw new Error(`${field} must not contain duplicates`);
  }
  return parsed;
}

export const runtimeEventEnvelopeSchema = z.strictObject({
  contractVersion: z.literal(RUNTIME_EVENT_CONTRACT_VERSION),
  eventId: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().min(1),
  source: z.enum(['backend', 'cloud_runner', 'hybrid_runner', 'local_runner', 'team']),
  type: z.string().min(1),
  data: z.unknown(),
  links: z.strictObject({
    parentRunId: z.string().min(1).optional(),
    toolCallId: z.string().min(1).optional(),
    teamRunId: z.string().min(1).optional(),
    subtaskId: z.string().min(1).optional(),
  }).optional(),
});

export type RuntimeEventEnvelope = z.infer<typeof runtimeEventEnvelopeSchema>;

export function parseRuntimeEventEnvelope(value: unknown): RuntimeEventEnvelope {
  return runtimeEventEnvelopeSchema.parse(value);
}

export const runnerRequestSchema = z.strictObject({
  contractVersion: z.literal(RUNNER_REQUEST_CONTRACT_VERSION),
  runId: z.string().min(1),
  agentId: z.string().min(1),
  runtime: z.enum(['local', 'cloud', 'hybrid']),
  payload: z.record(z.string(), z.unknown()),
});

export const runnerResponseSchema = z.strictObject({
  contractVersion: z.literal(RUNNER_RESPONSE_CONTRACT_VERSION),
  runId: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  errorMessage: z.string().optional(),
});

export type RunnerRequest = z.infer<typeof runnerRequestSchema>;
export type RunnerResponse = z.infer<typeof runnerResponseSchema>;

export const parseRunnerRequest = (value: unknown): RunnerRequest => runnerRequestSchema.parse(value);
export const parseRunnerResponse = (value: unknown): RunnerResponse => runnerResponseSchema.parse(value);

/**
 * Decode JSON values that crossed a runner boundary as one or more encoded
 * strings. Plain text is intentionally preserved, and decoding is bounded so
 * malformed or adversarial payloads cannot cause an unbounded loop.
 */
export function decodeNestedJsonValue(value: unknown, maxDepth = 3): unknown {
  let current = value;
  for (let depth = 0; depth < maxDepth && typeof current === 'string'; depth += 1) {
    const text = current.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('[') && !text.startsWith('"'))) {
      break;
    }
    try {
      const decoded = JSON.parse(text) as unknown;
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

export function wrapLegacyRunnerRequest(params: {
  agentId: string;
  runtime: RunnerRequest['runtime'];
  payload: Record<string, unknown>;
}): RunnerRequest {
  const runId = params.payload.id;
  if (typeof runId !== 'string' || !runId) throw new Error('legacy runner request payload.id must not be empty');
  return parseRunnerRequest({
    contractVersion: RUNNER_REQUEST_CONTRACT_VERSION,
    runId,
    agentId: params.agentId,
    runtime: params.runtime,
    payload: params.payload,
  });
}

export function unwrapRunnerRequest(request: RunnerRequest): Record<string, unknown> {
  return { ...request.payload };
}

export function wrapLegacyRunnerResponse(runId: string, payload: Record<string, unknown>): RunnerResponse {
  return parseRunnerResponse({
    contractVersion: RUNNER_RESPONSE_CONTRACT_VERSION,
    runId,
    ok: payload.ok,
    ...(Object.hasOwn(payload, 'result') ? { result: payload.result } : {}),
    ...(typeof payload.errorMessage === 'string' ? { errorMessage: payload.errorMessage } : {}),
  });
}

export function unwrapRunnerResponse(response: RunnerResponse): Record<string, unknown> {
  return {
    ok: response.ok,
    ...(Object.hasOwn(response, 'result') ? { result: response.result } : {}),
    ...(response.errorMessage !== undefined ? { errorMessage: response.errorMessage } : {}),
  };
}
