import { z } from 'zod';

export const CONTEXT_PACK_CONTRACT_VERSION = 'qlix.context-pack.v1' as const;
export const CONTEXT_REQUEST_CONTRACT_VERSION = 'qlix.context-request.v1' as const;

export const CONTEXT_REF_RE = /^ctx:[a-z0-9]+:v\d+:[a-f0-9]{12}$/i;

export function estimateContextTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

export const contextPackComponentSchema = z.strictObject({
  component: z.string().min(1),
  tokens: z.number().int().nonnegative(),
  text: z.string(),
  data: z.unknown().optional(),
});

export const contextPackReferenceSchema = z.strictObject({
  ref: z.string().regex(CONTEXT_REF_RE),
  component: z.string().min(1).optional(),
  summary: z.string(),
  tokens: z.number().int().nonnegative().optional(),
});

export const contextPackOmittedSchema = z.strictObject({
  component: z.string().min(1),
  reason: z.string().min(1),
});

export const contextPackSchema = z.strictObject({
  contractVersion: z.literal(CONTEXT_PACK_CONTRACT_VERSION),
  packId: z.string().min(1),
  snapshotVersion: z.number().int().positive(),
  goal: z.string().optional(),
  inline: z.array(contextPackComponentSchema),
  references: z.array(contextPackReferenceSchema),
  omitted: z.array(contextPackOmittedSchema),
  estimatedTokens: z.number().int().nonnegative(),
});

export type ContextPack = z.infer<typeof contextPackSchema>;
export type ContextPackComponent = z.infer<typeof contextPackComponentSchema>;
export type ContextPackReference = z.infer<typeof contextPackReferenceSchema>;

export const contextRequestSchema = z.strictObject({
  contractVersion: z.literal(CONTEXT_REQUEST_CONTRACT_VERSION),
  goal: z.string(),
  sources: z.array(z.string().min(1)).min(1),
  maxInlineTokens: z.number().int().positive().default(2_500),
  maxReferences: z.number().int().positive().default(20),
  detail: z.enum(['compact', 'progressive']).default('progressive'),
});

export type ContextRequest = z.infer<typeof contextRequestSchema>;

export function parseContextPack(value: unknown): ContextPack {
  return contextPackSchema.parse(value);
}

export function parseContextRequest(value: unknown): ContextRequest {
  return contextRequestSchema.parse(value);
}

export function extractContextRefs(text: string): string[] {
  const matches = text.match(/ctx:[a-z0-9]+:v\d+:[a-f0-9]{12}/gi) ?? [];
  return [...new Set(matches.map((ref) => ref.toLowerCase()))];
}
