import type { ConversationEffectHandler, ConversationOutboxJob } from './conversationWorkers.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import {
  PluginLifecycleRegistry,
  type DisposableRegistration,
  type PluginOwner,
} from '../plugins/pluginLifecycle.js';
import {
  fallbackPromptFromContent,
  type ConversationPrompt,
} from './conversationPrompt.js';

export type ConversationPluginContext = {
  orgId: string;
  threadId: string;
  idempotencyKey: string;
};

export type ConversationSendInput = {
  content: string;
  prompt: ConversationPrompt;
  metadata?: Record<string, unknown>;
};

export interface ConversationActionPlugin {
  name: string;
  validate(input: unknown): Record<string, unknown>;
  authorize(context: ConversationPluginContext, input: Record<string, unknown>): Promise<void>;
  execute(context: ConversationPluginContext, input: Record<string, unknown>): Promise<unknown>;
}

export interface ConversationChannelAdapter {
  channel: string;
  /** Existing agent PermissionScope this channel uses for outbound sends. Null = no JIT send. */
  sendScope?: PermissionScope | null;
  send(context: ConversationPluginContext, input: ConversationSendInput): Promise<unknown>;
}

/** Channel id → existing send scope. Choice prompts reuse these; they are not new catalog ids. */
export const CHANNEL_SEND_SCOPES: Record<string, PermissionScope | null> = {
  whatsapp: 'whatsapp.contact_send',
  assessment: null,
};

export function sendScopeForChannel(channel: string): PermissionScope | null {
  return CHANNEL_SEND_SCOPES[channel] ?? null;
}

/** Explicit registries keep workflow JSON from invoking arbitrary application code. */
export class ConversationPluginRegistry {
  private readonly actions = new PluginLifecycleRegistry<ConversationActionPlugin>();
  private readonly channels = new PluginLifecycleRegistry<ConversationChannelAdapter>();

  registerAction(plugin: ConversationActionPlugin, owner?: PluginOwner): this {
    this.registerActionDisposable(plugin, owner);
    return this;
  }

  registerActionDisposable(plugin: ConversationActionPlugin, owner?: PluginOwner): DisposableRegistration {
    return this.actions.register(plugin.name, plugin, { owner });
  }

  registerChannel(adapter: ConversationChannelAdapter, owner?: PluginOwner): this {
    this.registerChannelDisposable(adapter, owner);
    return this;
  }

  registerChannelDisposable(adapter: ConversationChannelAdapter, owner?: PluginOwner): DisposableRegistration {
    return this.channels.register(adapter.channel, adapter, { owner });
  }

  getChannel(channel: string): ConversationChannelAdapter | undefined {
    return this.channels.get(channel);
  }

  async deliverSend(
    channel: string,
    context: ConversationPluginContext,
    input: ConversationSendInput,
  ): Promise<unknown> {
    if (!this.channels.get(channel)) {
      throw new Error(`Conversation channel is not registered: ${channel || '(missing)'}`);
    }
    return this.channels.run(channel, (adapter) => adapter.send(context, input));
  }

  async disposeOwner(ownerId: string): Promise<void> {
    await Promise.all([this.actions.disposeOwner(ownerId), this.channels.disposeOwner(ownerId)]);
  }

  handlers(): Partial<Record<string, ConversationEffectHandler>> {
    return {
      action: async (job) => this.runAction(job),
      send: async (job) => this.runSend(job),
    };
  }

  private context(job: ConversationOutboxJob): ConversationPluginContext {
    return { orgId: job.orgId, threadId: job.threadId, idempotencyKey: job.idempotencyKey };
  }

  private async runAction(job: ConversationOutboxJob): Promise<unknown> {
    const action = typeof job.payload.action === 'string' ? job.payload.action : '';
    if (!this.actions.get(action)) throw new Error(`Conversation action is not allowlisted: ${action || '(missing)'}`);
    return this.actions.run(action, async (plugin) => {
      const input = plugin.validate(job.payload.input);
      const context = this.context(job);
      await plugin.authorize(context, input);
      return plugin.execute(context, input);
    });
  }

  private async runSend(job: ConversationOutboxJob): Promise<unknown> {
    const channel = typeof job.payload.channel === 'string' ? job.payload.channel : '';
    const content = typeof job.payload.content === 'string' ? job.payload.content : '';
    const prompt = fallbackPromptFromContent(content, job.payload.prompt);
    if (prompt.kind === 'text' && !prompt.content.trim()) {
      return { delivered: 'skipped_empty' };
    }
    if (!prompt.content.trim()) throw new Error('Conversation send content is required');
    const metadata = job.payload.metadata && typeof job.payload.metadata === 'object'
      ? job.payload.metadata as Record<string, unknown>
      : undefined;
    return this.deliverSend(channel, this.context(job), { content: prompt.content, prompt, metadata });
  }
}

export function constrainedClassifierPlugin(
  classify: (input: { text: string; allowedIntents: string[] }) => Promise<{ label: string; confidence: number }>,
): ConversationActionPlugin {
  return {
    name: 'conversation.classify',
    validate(raw) {
      const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const text = typeof value.text === 'string' ? value.text : '';
      const allowedIntents = Array.isArray(value.allowedIntents)
        ? value.allowedIntents.filter((item): item is string => typeof item === 'string')
        : [];
      if (!text || allowedIntents.length === 0) throw new Error('Classifier text and allowed intents are required');
      return { text, allowedIntents };
    },
    async authorize() {},
    async execute(_context, raw) {
      const input = raw as { text: string; allowedIntents: string[] };
      const result = await classify(input);
      if (!input.allowedIntents.includes(result.label)) {
        return { label: 'unclear', confidence: 0 };
      }
      return {
        label: result.label,
        confidence: Number.isFinite(result.confidence)
          ? Math.max(0, Math.min(1, result.confidence))
          : 0,
      };
    },
  };
}
