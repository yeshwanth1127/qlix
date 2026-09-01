import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { assertRunnerAuth } from '../agentChat/runnerAuth.js';
import {
  inferenceChatRequestSchema,
  openAiChatCompletionsRequestSchema,
  type InferenceChatRequest,
} from '../llm/inferenceSchemas.js';
import { assertModelAllowed, llmProviderFromModelId, ModelPolicyError, normalizeQlixInferenceModelId } from '../llm/modelPolicy.js';
import {
  chatCompletion,
  chatCompletionStream,
  InferenceConfigError,
  InferenceProviderError,
  isLlmProviderConfigured,
  LLM_APPLICATION_IDS,
  parseLlmProvider,
  type LlmProviderId,
} from '../llm/inferenceRouter.js';
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
  isOpenRouterFreeModelId,
  isQlixAutoModelId,
  parseReasoningEffort,
  selectInferenceModel,
  TIER_RANK,
  tierForModelId,
  type ReasoningEffort,
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
    `[inference] stage=error tag=${tag} provider=${
      error instanceof InferenceConfigError || error instanceof InferenceProviderError
        ? error.provider
        : 'unknown'
    } applicationId=${LLM_APPLICATION_IDS.agentInference} agentId=${agentId} latencyMs=${elapsed} error=${String((error as Error)?.message ?? error)}`,
  );
  if (error instanceof ModelPolicyError) {
    response.status(400).json({ error: { code: 'model_not_allowed', message: error.message } });
    return;
  }
  if (error instanceof InferenceConfigError) {
    response.status(503).json({ error: { code: 'inference_not_configured', message: error.message } });
    return;
  }
  if (error instanceof InferenceProviderError) {
    const msg = error.message.toLowerCase();
    let code = 'provider_error';
    const status = error.status || 502;
    if (status === 429 || msg.includes('rate') || msg.includes('429')) code = 'rate_limited';
    else if (msg.includes('quota') || /free.*(limit|exhaust)/i.test(error.message)) code = 'quota_exhausted';
    else if (msg.includes('context') || msg.includes('too long') || msg.includes('maximum')) {
      code = 'context_overflow';
    }
    response.status(status === 429 ? 429 : status >= 400 && status < 600 ? status : 502).json({
      error: { code, message: error.message },
    });
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
  llmProvider: LlmProviderId;
  orgId: string | null;
  planAllowedTiers: string[];
  reasoningEffort: ReasoningEffort | null;
}> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      runtime: true,
      llmMode: true,
      llmModel: true,
      llmProvider: true,
      reasoningEffort: true,
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
    llmProvider: parseLlmProvider(agent.llmProvider),
    orgId: agent.orgId,
    planAllowedTiers,
    reasoningEffort: parseReasoningEffort(agent.reasoningEffort),
  };
}

function logInferenceSuccess(input: {
  agentId: string;
  orgId: string | null;
  provider: LlmProviderId;
  model: string;
  usage?: unknown;
  latencyMs: number;
  streaming: boolean;
  cacheHit?: boolean;
  finishReason?: string | null;
  maxTokens?: number | null;
}): void {
  const usage =
    input.usage && typeof input.usage === 'object'
      ? (input.usage as Record<string, unknown>)
      : {};
  const completionTokens = Number(usage.completion_tokens) || 0;
  const details = usage.completion_tokens_details as { reasoning_tokens?: unknown } | undefined;
  const reasoningTokens = Number(details?.reasoning_tokens) || 0;
  console.log(
    '[inference] %s',
    JSON.stringify({
      stage: 'success',
      applicationId: LLM_APPLICATION_IDS.agentInference,
      provider: input.provider,
      model: input.model,
      status: 200,
      promptTokens: Number(usage.prompt_tokens) || 0,
      completionTokens,
      reasoningTokens,
      totalTokens: Number(usage.total_tokens) || 0,
      finishReason: input.finishReason ?? null,
      latencyMs: input.latencyMs,
      streaming: input.streaming,
      cacheHit: input.cacheHit ?? false,
      agentId: input.agentId,
      orgId: input.orgId,
    }),
  );
  // A truncated completion is billed in full and may carry no visible answer at
  // all, so it must not hide inside a "success" line.
  if (input.finishReason === 'length') {
    console.warn(
      `[inference] truncated agentId=${input.agentId} model=${input.model} ` +
        `maxTokens=${input.maxTokens ?? 'default'} completionTokens=${completionTokens} ` +
        `reasoningTokens=${reasoningTokens}`,
    );
  }
}

function resolveRoute(
  agent: { planAllowedTiers: string[]; llmProvider: LlmProviderId },
  request: InferenceChatRequest,
): RouteDecision {
  const requested = normalizeQlixInferenceModelId(request.model, agent.llmProvider);
  const decision = selectInferenceModel({
    requestedModel: requested,
    messages: request.messages as Array<{ role?: string; content?: unknown }>,
    tools: request.tools,
    planAllowedTiers: agent.planAllowedTiers,
    routingEnabled: isModelRoutingEnabled(),
    cascade: {
      phase: request.cascade_phase,
      forceHandoff: request.cascade_force_handoff === true,
      escalateReason: request.cascade_escalate_reason,
      scoutFailures: request.cascade_scout_failures,
      synthesisRound: request.cascade_synthesis_round === true,
    },
  });

  // Phase pin: keep model within scout or paid for cache warmth, unless handoff/escalate.
  const pinned = request.pinned_model?.trim();
  const forceHandoff = request.cascade_force_handoff === true;
  const escalatingToPaid =
    decision.cascadePhase === 'paid' && pinned && isOpenRouterFreeModelId(pinned);

  if (
    pinned &&
    !forceHandoff &&
    !escalatingToPaid &&
    pinned !== decision.routedModel &&
    !isQlixAutoModelId(pinned)
  ) {
    // Free router pin: allow openrouter/free and :free variants in scout
    if (decision.cascadePhase === 'scout' && isOpenRouterFreeModelId(pinned)) {
      return {
        ...decision,
        routedModel: pinned,
        routingTier: 'economy',
        reason: 'pinned_for_phase',
      };
    }
    const pinnedTier = tierForModelId(pinned);
    if (TIER_RANK[pinnedTier] <= TIER_RANK[decision.billableTier]) {
      // Don't pin a paid model while still in scout decision
      if (decision.cascadePhase === 'scout' && !isOpenRouterFreeModelId(pinned)) {
        return decision;
      }
      return {
        ...decision,
        routedModel: pinned,
        routingTier: pinnedTier,
        reason: decision.cascadePhase ? 'pinned_for_phase' : 'pinned_for_run',
      };
    }
  }
  return decision;
}

/** Gateway that will execute the routed model — may differ from the agent's home provider. */
function executionProviderForRoutedModel(
  routedModel: string,
  agentProvider: LlmProviderId,
): LlmProviderId {
  const lower = routedModel.trim().toLowerCase();
  if (lower.startsWith('exora/') || lower.startsWith('openrouter/')) {
    return llmProviderFromModelId(routedModel);
  }
  return agentProvider;
}

function applyRouteToRequest(
  request: InferenceChatRequest,
  decision: RouteDecision,
  agentEffort?: ReasoningEffort | null,
): InferenceChatRequest {
  // Complexity tiers size an Auto request; they are not a ceiling on a caller that
  // asked for a specific budget. Clamping a runner's 8192 down to a 4096 tier is
  // what let hidden reasoning consume the whole completion and return nothing.
  const maxTokens = request.max_tokens ?? decision.suggestedMaxTokens;
  return {
    ...request,
    model: decision.routedModel,
    max_tokens: decision.isAuto ? Math.min(maxTokens, decision.suggestedMaxTokens) : maxTokens,
    // An explicit per-request effort wins over the agent's saved preference.
    ...(request.reasoning_effort == null && agentEffort
      ? { reasoning_effort: agentEffort }
      : {}),
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

      assertModelAllowed(parsed.data.model, agent.llmProvider);
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
      assertModelAllowed(decision.routedModel, agent.llmProvider);
      const execProvider = executionProviderForRoutedModel(
        decision.routedModel,
        agent.llmProvider,
      );
      if (!isLlmProviderConfigured(execProvider)) {
        throw new InferenceConfigError(
          execProvider,
          `${execProvider === 'exora' ? 'EXORA_LLM_API_KEY' : 'OPENROUTER_API_KEY'} is required to run model "${decision.routedModel}"`,
        );
      }
      const inferenceRequest = applyRouteToRequest(withTools, decision, agent.reasoningEffort);

      console.log(
        `[inference] route agentProvider=${agent.llmProvider} execProvider=${execProvider} applicationId=${LLM_APPLICATION_IDS.agentInference} agentId=${agentId} requested=${decision.requestedModel} routed=${decision.routedModel} billable=${decision.billableTier} reason=${decision.reason} cascade=${decision.cascadePhase ?? 'n/a'} score=${decision.complexityScore}`,
      );

      if (parsed.data.stream === true) {
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        response.setHeader('X-Qlix-Routed-Model', decision.routedModel);
        response.setHeader('X-Qlix-Routing-Reason', decision.reason);
        response.flushHeaders?.();

        const result = await chatCompletionStream(
          inferenceRequest,
          (delta) => {
            if (delta.text) {
              response.write(`event: delta\ndata: ${JSON.stringify({ text: delta.text })}\n\n`);
            }
            if (delta.finishReason) {
              response.write(
                `event: finish\ndata: ${JSON.stringify({ finish_reason: delta.finishReason })}\n\n`,
              );
            }
          },
          {
            provider: execProvider,
            applicationId: LLM_APPLICATION_IDS.agentInference,
            planAllowedTiers: agent.planAllowedTiers,
          },
        );
        response.write(
          `event: done\ndata: ${JSON.stringify({
            content: result.content,
            finish_reason: result.finishReason,
            routed_model: decision.routedModel,
            routing_reason: decision.reason,
            billable_tier: decision.billableTier,
          })}\n\n`,
        );
        logInferenceSuccess({
          agentId,
          orgId: agent.orgId,
          provider: execProvider,
          model: decision.routedModel,
          latencyMs: Date.now() - t0,
          streaming: true,
          finishReason: result.finishReason,
          maxTokens: inferenceRequest.max_tokens ?? null,
        });
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
          logInferenceSuccess({
            agentId,
            orgId: agent.orgId,
            provider: execProvider,
            model: decision.routedModel,
            usage: cached.usage,
            latencyMs: Date.now() - t0,
            streaming: false,
            cacheHit: true,
          });
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

        const result = await chatCompletion(inferenceRequest, {
          provider: execProvider,
          applicationId: LLM_APPLICATION_IDS.agentInference,
          planAllowedTiers: agent.planAllowedTiers,
        });
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
        logInferenceSuccess({
          agentId,
          orgId: agent.orgId,
          provider: execProvider,
          model: decision.routedModel,
          usage: result.usage,
          latencyMs: Date.now() - t0,
          streaming: false,
          finishReason: result.finishReason,
          maxTokens: inferenceRequest.max_tokens ?? null,
        });
        response.json(body);
        return;
      }

      void cacheHit;
      const result = await chatCompletion(inferenceRequest, {
        provider: execProvider,
        applicationId: LLM_APPLICATION_IDS.agentInference,
        planAllowedTiers: agent.planAllowedTiers,
      });
      logInferenceSuccess({
        agentId,
        orgId: agent.orgId,
        provider: execProvider,
        model: decision.routedModel,
        usage: result.usage,
        latencyMs: Date.now() - t0,
        streaming: false,
        finishReason: result.finishReason,
        maxTokens: inferenceRequest.max_tokens ?? null,
      });
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
        cascade_phase: decision.cascadePhase ?? null,
        cascade_escalate_reason: decision.cascadeEscalateReason ?? null,
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

      const canonicalModel = normalizeQlixInferenceModelId(
        parsed.data.model,
        agent.llmProvider,
      );
      assertModelAllowed(canonicalModel, agent.llmProvider);

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
      assertModelAllowed(decision.routedModel, agent.llmProvider);
      const execProvider = executionProviderForRoutedModel(
        decision.routedModel,
        agent.llmProvider,
      );
      if (!isLlmProviderConfigured(execProvider)) {
        throw new InferenceConfigError(
          execProvider,
          `${execProvider === 'exora' ? 'EXORA_LLM_API_KEY' : 'OPENROUTER_API_KEY'} is required to run model "${decision.routedModel}"`,
        );
      }
      const inferenceRequest = applyRouteToRequest(baseRequest, decision, agent.reasoningEffort);

      const result = await chatCompletion(inferenceRequest, {
        provider: execProvider,
        applicationId: LLM_APPLICATION_IDS.agentInference,
        timeoutMs: s3InferenceTimeoutMs(),
        planAllowedTiers: agent.planAllowedTiers,
      });
      logInferenceSuccess({
        agentId,
        orgId: agent.orgId,
        provider: execProvider,
        model: decision.routedModel,
        usage: result.usage,
        latencyMs: Date.now() - t0,
        streaming: false,
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
