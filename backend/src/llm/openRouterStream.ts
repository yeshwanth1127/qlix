import type { InferenceChatRequest } from './inferenceSchemas.js';
import { OpenRouterConfigError, OpenRouterRequestError } from './openrouterClient.js';
import {
  resolveOpenRouterApiModel,
  type ResolveOpenRouterModelOptions,
} from './routing/resolveOpenRouterModel.js';

function openRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new OpenRouterConfigError();
  return key;
}

function openRouterBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
}

export type StreamDeltaHandler = (delta: {
  text?: string;
  finishReason?: string | null;
}) => void;

/**
 * Stream OpenRouter chat completions (SSE) and invoke onDelta for each text chunk.
 * Used by the gateway inference path so the UI can show real tokens instead of fake word deltas.
 */
export async function openRouterChatCompletionStream(
  request: InferenceChatRequest,
  onDelta: StreamDeltaHandler,
  options?: { timeoutMs?: number; signal?: AbortSignal } & ResolveOpenRouterModelOptions,
): Promise<{ content: string; finishReason: string | null }> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const url = `${openRouterBaseUrl().replace(/\/$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: resolveOpenRouterApiModel(request, options),
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: true,
  };
  if (request.tools != null && request.tools.length > 0) {
    body.tools = request.tools;
  }
  if (request.tool_choice !== undefined) {
    body.tool_choice = request.tool_choice;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options?.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openRouterApiKey()}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        message?: string;
      } | null;
      const message = String(payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`);
      throw new OpenRouterRequestError(response.status, message);
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
          const json = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string | null };
              finish_reason?: string | null;
            }>;
          };
          const choice = json.choices?.[0];
          const piece = choice?.delta?.content;
          if (typeof piece === 'string' && piece.length > 0) {
            content += piece;
            onDelta({ text: piece });
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
            onDelta({ finishReason });
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    return { content, finishReason };
  } finally {
    clearTimeout(timer);
  }
}
