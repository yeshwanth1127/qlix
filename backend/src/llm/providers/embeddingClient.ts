import { openrouterEmbeddings, type OpenRouterEmbeddingResult } from '../openrouterClient.js';

export type EmbeddingProviderId = 'openai' | 'openrouter';

function embeddingProvider(): EmbeddingProviderId {
  const value = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  return value === 'openai' ? 'openai' : 'openrouter';
}

function embeddingModel(provider: EmbeddingProviderId): string {
  const configured = process.env.EMBEDDING_MODEL?.trim() || 'openai/text-embedding-3-small';
  return provider === 'openai' ? configured.replace(/^openai\//, '') : configured;
}

export async function createEmbedding(
  text: string,
  options?: { timeoutMs?: number },
): Promise<OpenRouterEmbeddingResult> {
  const provider = embeddingProvider();
  const model = embeddingModel(provider);
  if (provider === 'openrouter') {
    return openrouterEmbeddings(text, model, options);
  }

  const key =
    process.env.EMBEDDING_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error('EMBEDDING_API_KEY or OPENAI_API_KEY is required for OpenAI embeddings');
  }
  const baseUrl =
    process.env.EMBEDDING_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(options?.timeoutMs ?? 120_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{ embedding?: unknown }>;
    model?: unknown;
    usage?: OpenRouterEmbeddingResult['usage'];
    error?: { message?: string };
    message?: string;
  } | null;
  if (!response.ok) {
    throw new Error(
      String(payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`),
    );
  }
  const embedding = payload?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Invalid embedding response from OpenAI');
  }
  return {
    embedding: embedding as number[],
    model: String(payload?.model ?? model),
    usage: payload?.usage,
  };
}
