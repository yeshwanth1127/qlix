import { z } from 'zod';

/**
 * OpenAI/OpenRouter-compatible chat message (text + optional tool fields).
 * Kept permissive so proxy can forward tool loops without lossy parsing.
 */
export const inferenceMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.null(), z.array(z.unknown())]).optional(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * How much of the completion budget a thinking model may spend reasoning.
 * Omitted means "use the per-purpose default" (see `reasoningBudget.ts`).
 */
export const reasoningEffortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

/** Shape of the call, which decides how small the default thinking share is. */
export const reasoningPurposeSchema = z.enum(['agent', 'planning', 'micro']);

export const inferenceChatRequestSchema = z.object({
  model: z.string().trim().min(1).max(200),
  messages: z.array(inferenceMessageSchema).min(1).max(100),
  temperature: z.number().min(0).max(2).optional(),
  // Ceiling leaves room for reasoning headroom on top of a 16k visible budget.
  max_tokens: z.number().int().min(1).max(32_768).optional(),
  stream: z.boolean().optional().default(false),
  reasoning_effort: reasoningEffortSchema.optional(),
  reasoning_purpose: reasoningPurposeSchema.optional(),
  /** OpenAI-style tool definitions (function tools). */
  tools: z.array(z.unknown()).optional(),
  tool_choice: z
    .union([z.string(), z.enum(['auto', 'none', 'required']), z.record(z.string(), z.unknown())])
    .optional(),
  /** Hash of the tool definitions; stable per agent once the tool array is scope-derived. */
  tools_hash: z.string().trim().max(16).optional(),
  /**
   * Concrete model the router already chose for this cascade *phase*.
   * Scout pins stay on free; escalate / force_handoff clears free pins so paid can run.
   */
  pinned_model: z.string().trim().max(200).optional(),
  /** Margin cascade phase from the runner. */
  cascade_phase: z.enum(['scout', 'paid']).optional(),
  /** Clear pin and re-route (rate limit / escalate). */
  cascade_force_handoff: z.boolean().optional(),
  cascade_escalate_reason: z
    .enum([
      'synthesis',
      'high_complexity',
      'tool_failures',
      'length_retry_exhausted',
      'free_unhealthy',
      'forced',
      'none',
    ])
    .optional(),
  cascade_scout_failures: z.number().int().min(0).max(20).optional(),
  cascade_synthesis_round: z.boolean().optional(),
  metadata: z
    .object({
      runId: z.string().trim().min(1).max(120).optional(),
      agentId: z.string().trim().min(1).max(120).optional(),
    })
    .optional(),
});

export type InferenceChatRequest = z.infer<typeof inferenceChatRequestSchema>;
export type ReasoningEffortInput = z.infer<typeof reasoningEffortSchema>;

/** OpenAI `/v1/chat/completions` body (Agent-S3, vision messages). */
export const openAiChatCompletionsRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    messages: z.array(inferenceMessageSchema).min(1).max(100),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().min(1).max(32_768).optional(),
    stream: z.boolean().optional().default(false),
    tools: z.array(z.unknown()).optional(),
    tool_choice: z
      .union([z.string(), z.enum(['auto', 'none', 'required']), z.record(z.string(), z.unknown())])
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type OpenAiChatCompletionsRequest = z.infer<typeof openAiChatCompletionsRequestSchema>;
