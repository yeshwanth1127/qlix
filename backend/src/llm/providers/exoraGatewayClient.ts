import { setTimeout as sleep } from 'node:timers/promises';
import type { InferenceChatRequest } from '../inferenceSchemas.js';
import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  InferenceProvider,
  InferenceToolCall,
  StreamDeltaHandler,
} from './types.js';
import { InferenceConfigError, InferenceProviderError } from './types.js';

function exoraApiKey(): string {
  const key = process.env.EXORA_LLM_API_KEY?.trim();
  if (!key) {
    throw new InferenceConfigError(
      'exora',
      'EXORA_LLM_API_KEY is required for Exora proxy inference',
    );
  }
  return key;
}

function exoraBaseUrl(): string {
  return process.env.EXORA_LLM_BASE_URL?.trim() || 'https://llm.exora.solutions/v1';
}

function resolveExoraModel(model: string): string {
  return model.trim().replace(/^exora\//i, '');
}

function requestBody(request: InferenceChatRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: resolveExoraModel(request.model),
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream,
  };
  if (request.tools?.length) body.tools = request.tools;
  if (request.tool_choice !== undefined) body.tool_choice = request.tool_choice;
  return body;
}

function requestHeaders(applicationId: string, stream = false): Record<string, string> {
  return {
    Authorization: `Bearer ${exoraApiKey()}`,
    'Content-Type': 'application/json',
    'X-Exora-Application': applicationId,
    ...(stream ? { Accept: 'text/event-stream' } : {}),
  };
}

function parseToolCalls(rawCalls: unknown): InferenceToolCall[] | null {
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return null;
  const toolCalls: InferenceToolCall[] = [];
  for (const rawCall of rawCalls) {
    const call = rawCall as Record<string, unknown>;
    const fn = call.function as Record<string, unknown> | undefined;
    const id = String(call.id ?? '');
    const name = String(fn?.name ?? '');
    if (!id || !name) continue;
    toolCalls.push({
      id,
      type: String(call.type ?? 'function'),
      function: {
        name,
        arguments: fn?.arguments == null ? '' : String(fn.arguments),
      },
    });
  }
  return toolCalls.length ? toolCalls : null;
}

async function chatCompletion(
  request: InferenceChatRequest,
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const retries = options.retries ?? 1;
  const url = `${exoraBaseUrl().replace(/\/$/, '')}/chat/completions`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: requestHeaders(options.applicationId),
        body: JSON.stringify(requestBody(request, false)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok) {
        const message = String(
          payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`,
        );
        throw new InferenceProviderError('exora', response.status, message);
      }
      const choice = payload?.choices?.[0];
      const message = choice?.message;
      return {
        content: message?.content == null ? '' : String(message.content).trim(),
        toolCalls: parseToolCalls(message?.tool_calls),
        finishReason: choice?.finish_reason ?? null,
        usage: payload?.usage,
        provider: typeof payload?.provider === 'string' ? payload.provider : 'exora',
      };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const retryable =
        error instanceof InferenceProviderError
          ? [408, 425, 429, 500, 502, 503, 504].includes(error.status)
          : true;
      if (!retryable || attempt === retries) break;
      await sleep(250 * (attempt + 1));
    }
  }

  throw lastError ?? new Error('Exora gateway request failed');
}

async function chatCompletionStream(
  request: InferenceChatRequest,
  onDelta: StreamDeltaHandler,
  options: ChatCompletionOptions,
): Promise<{ content: string; finishReason: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(
      `${exoraBaseUrl().replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: requestHeaders(options.applicationId, true),
        body: JSON.stringify(requestBody(request, true)),
        signal: controller.signal,
      },
    );
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        message?: string;
      } | null;
      throw new InferenceProviderError(
        'exora',
        response.status,
        String(payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`),
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let finishReason: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const event = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string | null };
              finish_reason?: string | null;
            }>;
          };
          const choice = event.choices?.[0];
          const piece = choice?.delta?.content;
          if (typeof piece === 'string' && piece) {
            content += piece;
            onDelta({ text: piece });
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
            onDelta({ finishReason });
          }
        } catch {
          // Ignore malformed gateway events while preserving the remaining stream.
        }
      }
    }

    return { content, finishReason };
  } finally {
    clearTimeout(timer);
  }
}

export const exoraGatewayProvider: InferenceProvider = {
  id: 'exora',
  chatCompletion,
  chatCompletionStream,
};
