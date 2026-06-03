import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { assertRunnerAuth } from '../agentChat/runnerAuth.js';
import {
  inferenceChatRequestSchema,
  openAiChatCompletionsRequestSchema,
  type InferenceChatRequest,
} from '../llm/inferenceSchemas.js';
import { assertModelAllowed, ModelPolicyError, normalizeQlixInferenceModelId } from '../llm/modelPolicy.js';
import {
  openRouterChatCompletion,
  OpenRouterConfigError,
  OpenRouterRequestError,
} from '../llm/openrouterClient.js';
import { cacheToolDefinitions, getCachedTools } from '../llm/toolCache.js';

function s3InferenceTimeoutMs(): number {
  const raw = process.env.QLIX_S3_INFERENCE_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : 90_000;
  return Number.isFinite(n) && n > 0 ? n : 90_000;
}

function handleInferenceProxyError(
  response: Response,
  error: unknown,
  agentId: string,
  elapsed: number,
  tag: string,
): void {
  console.warn(
    `[inference] stage=error tag=${tag} agentId=${agentId} latencyMs=${elapsed} error=${String((error as Error)?.message ?? error)}`,
  );
  if (error instanceof ModelPolicyError) {
    response.status(400).json({ error: { code: 'model_not_allowed', message: error.message } });
    return;
  }
  if (error instanceof OpenRouterConfigError) {
    response.status(503).json({ error: { code: 'inference_not_configured', message: error.message } });
    return;
  }
  if (error instanceof OpenRouterRequestError) {
    response.status(502).json({ error: { code: 'provider_error', message: error.message } });
    return;
  }
  const msg = String((error as Error)?.message ?? 'Unauthorized');
  if (/runner/i.test(msg) || /token/i.test(msg)) {
    response.status(401).json({ error: { code: 'runner_unauthorized', message: msg } });
    return;
  }
  response.status(500).json({ error: { code: 'inference_failed', message: 'Inference request failed' } });
}

async function assertProxyAgent(agentId: string): Promise<{ id: string; runtime: string; llmMode: string }> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, runtime: true, llmMode: true },
  });
  if (!agent || (agent.runtime !== 'cloud' && agent.runtime !== 'hybrid')) {
    throw Object.assign(new Error('Hosted agent not found'), { code: 'not_found' });
  }
  if (agent.llmMode !== 'proxy') {
    throw Object.assign(new Error('Inference proxy is only available for llmMode=proxy'), {
      code: 'invalid_mode',
    });
  }
  return agent;
}

export function createInferenceProxyRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post('/:agentId/inference/chat', async (request: Request, response: Response) => {
    const parsed = inferenceChatRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'Invalid inference request payload' },
      });
      return;
    }
    const agentId = String(request.params.agentId);
    const t0 = Date.now();
    try {
      await assertRunnerAuth(agentId, request);
      await assertProxyAgent(agentId);

      assertModelAllowed(parsed.data.model);

      // OPTIMIZATION: Handle tool caching via tools_hash
      // Round 1: client sends tools + tools_hash -> cache them
      // Round 2+: client sends tools_hash only -> restore from cache before forwarding to OpenRouter
      const toolsHash = parsed.data.tools_hash;
      let toolsForOpenRouter = parsed.data.tools;

      if (toolsHash) {
        if (parsed.data.tools && Array.isArray(parsed.data.tools)) {
          // Round 1: Store tools for future rounds
          cacheToolDefinitions(agentId, toolsHash, parsed.data.tools);
          console.log(`[inference] tools_cached agentId=${agentId} hash=${toolsHash} count=${parsed.data.tools.length}`);
        } else if (!toolsForOpenRouter) {
          // Round 2+: Look up tools from cache
          const cachedTools = getCachedTools(agentId, toolsHash);
          if (cachedTools) {
            toolsForOpenRouter = cachedTools;
            console.log(`[inference] tools_restored agentId=${agentId} hash=${toolsHash} count=${cachedTools.length}`);
          } else {
            // Cache miss (expired or not found) - client should resend tools
            console.warn(
              `[inference] tools_cache_miss agentId=${agentId} hash=${toolsHash} - client must resend tools on next round`
            );
          }
        }
      }

      // Forward to OpenRouter with tools (either fresh or from cache)
      const inferenceRequest = {
        ...parsed.data,
        tools: toolsForOpenRouter,
      };

      const result = await openRouterChatCompletion(inferenceRequest);
      response.json({
        content: result.content,
        tool_calls: result.toolCalls,
        finish_reason: result.finishReason,
        usage: result.usage ?? {},
        provider: result.provider ?? null,
      });
    } catch (error: any) {
      const elapsed = Date.now() - t0;
      if ((error as { code?: string })?.code === 'not_found') {
        response.status(404).json({ error: { code: 'not_found', message: 'Hosted agent not found' } });
        return;
      }
      if ((error as { code?: string })?.code === 'invalid_mode') {
        response.status(400).json({ error: { code: 'invalid_mode', message: error.message } });
        return;
      }
      handleInferenceProxyError(response, error, agentId, elapsed, 'chat');
    }
  });

  /** OpenAI-compatible shim for Agent-S3 (gui-agents) — auth via Bearer runner token. */
  router.post('/:agentId/inference/v1/chat/completions', async (request: Request, response: Response) => {
    const parsed = openAiChatCompletionsRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'Invalid OpenAI chat completions payload' },
      });
      return;
    }
    if (parsed.data.stream) {
      response.status(400).json({
        error: { code: 'stream_not_supported', message: 'Streaming is not supported on this endpoint' },
      });
      return;
    }

    const agentId = String(request.params.agentId);
    const t0 = Date.now();
    try {
      await assertRunnerAuth(agentId, request);
      await assertProxyAgent(agentId);

      const canonicalModel = normalizeQlixInferenceModelId(parsed.data.model);
      assertModelAllowed(canonicalModel);

      const meta = parsed.data.metadata;
      const inferenceRequest: InferenceChatRequest = {
        model: canonicalModel,
        messages: parsed.data.messages,
        temperature: parsed.data.temperature,
        max_tokens: parsed.data.max_tokens,
        stream: false,
        tools: parsed.data.tools,
        tool_choice: parsed.data.tool_choice,
        metadata:
          meta && typeof meta === 'object'
            ? {
                runId: typeof meta.runId === 'string' ? meta.runId : undefined,
                agentId: typeof meta.agentId === 'string' ? meta.agentId : agentId,
              }
            : { agentId },
      };

      const result = await openRouterChatCompletion(inferenceRequest, {
        timeoutMs: s3InferenceTimeoutMs(),
      });

      const message: Record<string, unknown> = { role: 'assistant', content: result.content || null };
      if (result.toolCalls?.length) {
        message.tool_calls = result.toolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        }));
      }

      response.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        model: parsed.data.model,
        choices: [
          {
            index: 0,
            message,
            finish_reason: result.finishReason ?? 'stop',
          },
        ],
        usage: result.usage ?? {},
      });
    } catch (error: any) {
      const elapsed = Date.now() - t0;
      if (error?.code === 'not_found') {
        response.status(404).json({ error: { code: 'not_found', message: 'Hosted agent not found' } });
        return;
      }
      if (error?.code === 'invalid_mode') {
        response.status(400).json({ error: { code: 'invalid_mode', message: error.message } });
        return;
      }
      handleInferenceProxyError(response, error, agentId, elapsed, 'v1');
    }
  });

  return router;
}

