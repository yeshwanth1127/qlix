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

export const inferenceChatRequestSchema = z.object({
  model: z.string().trim().min(1).max(200),
  messages: z.array(inferenceMessageSchema).min(1).max(100),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(16_384).optional(),
  stream: z.boolean().optional().default(false),
  /** OpenAI-style tool definitions (function tools). */
  tools: z.array(z.unknown()).optional(),
  tool_choice: z
    .union([z.string(), z.enum(['auto', 'none', 'required']), z.record(z.string(), z.unknown())])
    .optional(),
  /** OPTIMIZATION: Hash of tool definitions for client-side caching (cloud runner sends tools only on round 1). */
  tools_hash: z.string().trim().max(16).optional(),
  metadata: z
    .object({
      runId: z.string().trim().min(1).max(120).optional(),
      agentId: z.string().trim().min(1).max(120).optional(),
    })
    .optional(),
});

export type InferenceChatRequest = z.infer<typeof inferenceChatRequestSchema>;

/** OpenAI `/v1/chat/completions` body (Agent-S3, vision messages). */
export const openAiChatCompletionsRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    messages: z.array(inferenceMessageSchema).min(1).max(100),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().min(1).max(16_384).optional(),
    stream: z.boolean().optional().default(false),
    tools: z.array(z.unknown()).optional(),
    tool_choice: z
      .union([z.string(), z.enum(['auto', 'none', 'required']), z.record(z.string(), z.unknown())])
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type OpenAiChatCompletionsRequest = z.infer<typeof openAiChatCompletionsRequestSchema>;
