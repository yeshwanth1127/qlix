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
import {
  completionCacheKey,
  getCachedCompletion,
  isCompletionCacheEnabled,
  setCachedCompletion,
} from '../llm/completionCache.js';
import { getPlanConfig } from '../billings/lib/subscriptionPlans.js';
import {
  isModelRoutingEnabled,
  isQlixAutoModelId,
  selectInferenceModel,
  TIER_RANK,
  tierForModelId,
  type RouteDecision,
} from '../llm/routing/index.js';

function s3InferenceTimeoutMs(): number {
  const raw = process.env.QLIX_S3_INFERENCE_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : 120_000;
  return Number.isFinite(n) && n > 0 ? n : 120_000;
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

async function assertProxyAgent(agentId: string): Promise<{
  id: string;
  runtime: string;
  llmMode: string;
  llmModel: string;
  planAllowedTiers: string[];
}> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      runtime: true,
      llmMode: true,
      llmModel: true,
      orgId: true,
      organization: { select: { plan: true } },
    },
  });
  if (!agent || (agent.runtime !== 'cloud' && agent.runtime !== 'hybrid')) {
    throw Object.assign(new Error('Hosted agent not found'), { code: 'not_found' });
  }
  if (agent.llmMode !== 'proxy') {
    throw Object.assign(new Error('Inference proxy is only available for llmMode=proxy'), {
      code: 'invalid_mode',
    });
  }
  const planName = agent.organization?.plan ?? 'free';
  const planAllowedTiers = getPlanConfig(planName).allowedModelTiers;
  return {
    id: agent.id,
    runtime: agent.runtime,
    llmMode: agent.llmMode,
    llmModel: agent.llmModel,
    planAllowedTiers,
  };
}

function resolveRoute(
  agent: { planAllowedTiers: string[] },
  request: InferenceChatRequest,
): RouteDecision {
  const requested = normalizeQlixInferenceModelId(request.model);
  const decision = selectInferenceModel({
    requestedModel: requested,
    messages: request.messages as Array<{ role?: string; content?: unknown }>,
    tools: request.tools,
    planAllowedTiers: agent.planAllowedTiers,
    routingEnabled: isModelRoutingEnabled(),
  });

  // Rounds 2+ of a tool loop: keep the model the run started on. Switching provider
  // mid-run throws away the prompt-prefix cache and re-scores complexity against a
  // tool nudge rather than the real task. Still gated by policy + plan tier below.
  const pinned = request.pinned_model?.trim();
  if (pinned && pinned !== decision.routedModel && !isQlixAutoModelId(pinned)) {
    const pinnedTier = tierForModelId(pinned);
    if (TIER_RANK[pinnedTier] <= TIER_RANK[decision.billableTier]) {
      return { ...decision, routedModel: pinned, routingTier: pinnedTier, reason: 'pinned_for_run' };
    }
  }
  return decision;
}

function applyRouteToRequest(
  request: InferenceChatRequest,
  decision: RouteDecision,
): InferenceChatRequest {
  const maxTokens =
    request.max_tokens == null
      ? decision.suggestedMaxTokens
      : Math.min(request.max_tokens, decision.suggestedMaxTokens);
  return {
    ...request,
    model: decision.routedModel,
    max_tokens: maxTokens,
  };
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
      const agent = await assertProxyAgent(agentId);

      assertModelAllowed(parsed.data.model);
      if (isQlixAutoModelId(parsed.data.model)) {
        // Auto ids are allowed through policy; never forwarded raw to OpenRouter.
      }

      const toolsHash = parsed.data.tools_hash;
      let toolsForOpenRouter = parsed.data.tools;

      if (toolsHash) {
        if (parsed.data.tools && Array.isArray(parsed.data.tools)) {
          cacheToolDefinitions(agentId, toolsHash, parsed.data.tools);
          console.log(`[inference] tools_cached agentId=${agentId} hash=${toolsHash} count=${parsed.data.tools.length}`);
        } else if (!toolsForOpenRouter) {
          const cachedTools = getCachedTools(agentId, toolsHash);
          if (cachedTools) {
            toolsForOpenRouter = cachedTools;
            console.log(`[inference] tools_restored agentId=${agentId} hash=${toolsHash} count=${cachedTools.length}`);
          } else {
            console.warn(
              `[inference] tools_cache_miss agentId=${agentId} hash=${toolsHash} - client must resend tools on next round`,
            );
          }
        }
      }

      const withTools: InferenceChatRequest = {
        ...parsed.data,
        tools: toolsForOpenRouter,
      };
      const decision = resolveRoute(agent, withTools);
      if (decision.isAuto && isQlixAutoModelId(decision.routedModel)) {
        throw new ModelPolicyError('Auto routing failed to resolve a concrete model');
      }
      assertModelAllowed(decision.routedModel);
      const inferenceRequest = applyRouteToRequest(withTools, decision);

      console.log(
        `[inference] route agentId=${agentId} requested=${decision.requestedModel} routed=${decision.routedModel} billable=${decision.billableTier} reason=${decision.reason} score=${decision.complexityScore}`,
      );

      if (parsed.data.stream === true) {
        const { openRouterChatCompletionStream } = await import('../llm/openRouterStream.js');
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        response.setHeader('X-Qlix-Routed-Model', decision.routedModel);
        response.setHeader('X-Qlix-Routing-Reason', decision.reason);
        response.flushHeaders?.();

        const result = await openRouterChatCompletionStream(inferenceRequest, (delta) => {
          if (delta.text) {
            response.write(`event: delta\ndata: ${JSON.stringify({ text: delta.text })}\n\n`);
          }
          if (delta.finishReason) {
            response.write(
              `event: finish\ndata: ${JSON.stringify({ finish_reason: delta.finishReason })}\n\n`,
            );
          }
        });
        response.write(
          `event: done\ndata: ${JSON.stringify({
            content: result.content,
            finish_reason: result.finishReason,
            routed_model: decision.routedModel,
            routing_reason: decision.reason,
            billable_tier: decision.billableTier,
          })}\n\n`,
        );
        response.end();
        return;
      }

      let cacheHit = false;
      if (isCompletionCacheEnabled() && !parsed.data.stream) {
        const key = completionCacheKey({
          agentId,
          model: inferenceRequest.model,
          messages: inferenceRequest.messages,
          toolsHash: toolsHash ?? null,
          temperature: inferenceRequest.temperature,
          maxTokens: inferenceRequest.max_tokens,
        });
        const cached = getCachedCompletion(key) as
          | {
              content: string;
              tool_calls: unknown;
              finish_reason: string | null;
              usage: unknown;
              provider: string | null;
            }
          | null;
        if (cached) {
          cacheHit = true;
          console.log(`[inference] cache_hit agentId=${agentId} model=${inferenceRequest.model}`);
          response.json({
            ...cached,
            routed_model: decision.routedModel,
            requested_model: decision.requestedModel,
            routing_reason: decision.reason,
            billable_tier: decision.billableTier,
            cache_hit: true,
          });
          return;
        }

        const result = await openRouterChatCompletion(inferenceRequest);
        const body = {
          content: result.content,
          tool_calls: result.toolCalls,
          finish_reason: result.finishReason,
          usage: result.usage ?? {},
          provider: result.provider ?? null,
          routed_model: decision.routedModel,
          requested_model: decision.requestedModel,
          routing_reason: decision.reason,
          billable_tier: decision.billableTier,
          cache_hit: false,
        };
        // Only cache final text answers without tool calls (safer for agent loops).
        if (!result.toolCalls?.length && result.content) {
          setCachedCompletion(key, {
            content: result.content,
            tool_calls: result.toolCalls,
            finish_reason: result.finishReason,
            usage: result.usage ?? {},
            provider: result.provider ?? null,
          });
        }
        response.json(body);
        return;
      }

      void cacheHit;
      const result = await openRouterChatCompletion(inferenceRequest);
      response.json({
        content: result.content,
        tool_calls: result.toolCalls,
        finish_reason: result.finishReason,
        usage: result.usage ?? {},
        provider: result.provider ?? null,
        routed_model: decision.routedModel,
        requested_model: decision.requestedModel,
        routing_reason: decision.reason,
        billable_tier: decision.billableTier,
        cache_hit: false,
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
      const agent = await assertProxyAgent(agentId);

      const canonicalModel = normalizeQlixInferenceModelId(parsed.data.model);
      assertModelAllowed(canonicalModel);

      const meta = parsed.data.metadata;
      const baseRequest: InferenceChatRequest = {
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

      const decision = resolveRoute(agent, baseRequest);
      assertModelAllowed(decision.routedModel);
      const inferenceRequest = applyRouteToRequest(baseRequest, decision);

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
        model: decision.routedModel,
        choices: [
          {
            index: 0,
            message,
            finish_reason: result.finishReason ?? 'stop',
          },
        ],
        usage: result.usage ?? {},
        qlix_routing: {
          requested_model: decision.requestedModel,
          routed_model: decision.routedModel,
          billable_tier: decision.billableTier,
          reason: decision.reason,
        },
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
