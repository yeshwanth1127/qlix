import { z } from 'zod';

export const TRACE_ENVELOPE_CONTRACT_VERSION = 'qlix.trace-envelope.v1' as const;

export const TRACE_EXECUTION_KINDS = [
  'agent_run',
  'team_run',
  'subagent',
  'gateway',
  'brain',
  'conversation',
] as const;

export type TraceExecutionKind = (typeof TRACE_EXECUTION_KINDS)[number];

export const traceEnvelopeSchema = z.strictObject({
  contractVersion: z.literal(TRACE_ENVELOPE_CONTRACT_VERSION),
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  executionId: z.string().min(1),
  executionKind: z.enum(TRACE_EXECUTION_KINDS),
  orgId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  roundId: z.string().min(1).optional(),
  attempt: z.number().int().nonnegative().optional(),
  toolCallId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
});

export type TraceEnvelope = z.infer<typeof traceEnvelopeSchema>;

export function parseTraceEnvelope(value: unknown): TraceEnvelope {
  return traceEnvelopeSchema.parse(value);
}

export function createTraceEnvelope(input: Omit<TraceEnvelope, 'contractVersion'>): TraceEnvelope {
  return parseTraceEnvelope({
    contractVersion: TRACE_ENVELOPE_CONTRACT_VERSION,
    ...input,
  });
}

export function childTraceEnvelope(
  parent: TraceEnvelope,
  input: Pick<TraceEnvelope, 'spanId' | 'executionId' | 'executionKind'> & Partial<TraceEnvelope>,
): TraceEnvelope {
  return createTraceEnvelope({
    traceId: parent.traceId,
    parentSpanId: parent.spanId,
    orgId: parent.orgId,
    agentId: parent.agentId,
    roundId: parent.roundId,
    attempt: parent.attempt,
    ...input,
    spanId: input.spanId,
    executionId: input.executionId,
    executionKind: input.executionKind,
  });
}

export function readTraceEnvelope(value: unknown): TraceEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const trace = (value as { trace?: unknown }).trace;
  try {
    return parseTraceEnvelope(trace ?? value);
  } catch {
    return null;
  }
}

export function attachTrace<T>(data: T, envelope: TraceEnvelope): T | Record<string, unknown> {
  const existing = readTraceEnvelope(data);
  if (existing) return data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>), trace: envelope };
  }
  return { value: data, trace: envelope };
}

export function traceLinks(envelope: TraceEnvelope): Record<string, string> {
  return {
    traceId: envelope.traceId,
    spanId: envelope.spanId,
    executionId: envelope.executionId,
    executionKind: envelope.executionKind,
    ...(envelope.parentSpanId ? { parentSpanId: envelope.parentSpanId } : {}),
    ...(envelope.agentId ? { agentId: envelope.agentId } : {}),
    ...(envelope.orgId ? { orgId: envelope.orgId } : {}),
    ...(envelope.roundId ? { roundId: envelope.roundId } : {}),
    ...(envelope.toolCallId ? { toolCallId: envelope.toolCallId } : {}),
    ...(envelope.nodeId ? { nodeId: envelope.nodeId } : {}),
  };
}
