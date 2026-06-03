import { setTimeout as sleep } from 'node:timers/promises';
import type { InferenceChatRequest } from './inferenceSchemas.js';

export class OpenRouterConfigError extends Error {
  constructor(message = 'OPENROUTER_API_KEY is required for proxy inference') {
    super(message);
  }
}

export class OpenRouterRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface OpenRouterToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface OpenRouterChatResult {
  content: string;
  /** Present when the model requests tool execution instead of final text. */
  toolCalls: OpenRouterToolCall[] | null;
  finishReason: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  provider?: string | null;
}

function openRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new OpenRouterConfigError();
  return key;
}

function openRouterBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
}

export interface OpenRouterEmbeddingResult {
  embedding: number[];
  model: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

export async function openrouterEmbeddings(
  text: string,
  model = 'openai/text-embedding-3-small',
  options?: { timeoutMs?: number },
): Promise<OpenRouterEmbeddingResult> {
  const url = `${openRouterBaseUrl().replace(/\/$/, '')}/embeddings`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openRouterApiKey()}`,
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(options?.timeoutMs ?? 15_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok) {
    const message = String(payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`);
    throw new OpenRouterRequestError(response.status, message);
  }
  const embedding = payload?.data?.[0]?.embedding as unknown;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Invalid embedding response from OpenRouter');
  }
  return { embedding: embedding as number[], model: String(payload?.model ?? model), usage: payload?.usage };
}

export async function openRouterChatCompletion(
  request: InferenceChatRequest,
  options?: { timeoutMs?: number; retries?: number },
): Promise<OpenRouterChatResult> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const retries = options?.retries ?? 2;
  const url = `${openRouterBaseUrl().replace(/\/$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: request.model.replace(/^openrouter\//, ''),
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: false,
  };
  if (request.tools != null && request.tools.length > 0) {
    body.tools = request.tools;
  }
  if (request.tool_choice !== undefined) {
    body.tool_choice = request.tool_choice;
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterApiKey()}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        const message = String(payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`);
        throw new OpenRouterRequestError(response.status, message);
      }
      const choice = payload?.choices?.[0];
      const msg = choice?.message;
      const rawContent = msg?.content;
      const content = rawContent == null || rawContent === '' ? '' : String(rawContent).trim();
      const rawCalls = msg?.tool_calls;
      let toolCalls: OpenRouterToolCall[] | null = null;
      if (Array.isArray(rawCalls) && rawCalls.length > 0) {
        toolCalls = [];
        for (const tc of rawCalls) {
          const t = tc as Record<string, unknown>;
          const id = String(t.id ?? '');
          const fn = t.function as Record<string, unknown> | undefined;
          const name = String(fn?.name ?? '');
          const args = fn?.arguments != null ? String(fn.arguments) : '';
          if (id && name) {
            toolCalls.push({
              id,
              type: String(t.type ?? 'function'),
              function: { name, arguments: args },
            });
          }
        }
        if (toolCalls.length === 0) toolCalls = null;
      }
      return {
        content,
        toolCalls,
        finishReason: choice?.finish_reason ?? null,
        usage: payload?.usage,
        provider: payload?.provider ?? null,
      };
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const retryable =
        error instanceof OpenRouterRequestError
          ? [408, 425, 429, 500, 502, 503, 504].includes(error.status)
          : true;
      if (!retryable || attempt === retries) break;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('OpenRouter request failed');
}

