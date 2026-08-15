import type { ConversationEffectHandler, ConversationOutboxJob } from './conversationWorkers.service.js';

export type ConversationPluginContext = {
  orgId: string;
  threadId: string;
  idempotencyKey: string;
};

export interface ConversationActionPlugin {
  name: string;
  validate(input: unknown): Record<string, unknown>;
  authorize(context: ConversationPluginContext, input: Record<string, unknown>): Promise<void>;
  execute(context: ConversationPluginContext, input: Record<string, unknown>): Promise<unknown>;
}

export interface ConversationChannelAdapter {
  channel: string;
  send(
    context: ConversationPluginContext,
    input: { content: string; metadata?: Record<string, unknown> },
  ): Promise<unknown>;
}

/** Explicit registries keep workflow JSON from invoking arbitrary application code. */
export class ConversationPluginRegistry {
  private readonly actions = new Map<string, ConversationActionPlugin>();
  private readonly channels = new Map<string, ConversationChannelAdapter>();

  registerAction(plugin: ConversationActionPlugin): this {
    if (this.actions.has(plugin.name)) throw new Error(`Conversation action already registered: ${plugin.name}`);
    this.actions.set(plugin.name, plugin);
    return this;
  }

  registerChannel(adapter: ConversationChannelAdapter): this {
    if (this.channels.has(adapter.channel)) throw new Error(`Conversation channel already registered: ${adapter.channel}`);
    this.channels.set(adapter.channel, adapter);
    return this;
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
    const plugin = this.actions.get(action);
    if (!plugin) throw new Error(`Conversation action is not allowlisted: ${action || '(missing)'}`);
    const input = plugin.validate(job.payload.input);
    const context = this.context(job);
    await plugin.authorize(context, input);
    return plugin.execute(context, input);
  }

  private async runSend(job: ConversationOutboxJob): Promise<unknown> {
    const channel = typeof job.payload.channel === 'string' ? job.payload.channel : '';
    const adapter = this.channels.get(channel);
    if (!adapter) throw new Error(`Conversation channel is not registered: ${channel || '(missing)'}`);
    const content = typeof job.payload.content === 'string' ? job.payload.content : '';
    if (!content) throw new Error('Conversation send content is required');
    const metadata = job.payload.metadata && typeof job.payload.metadata === 'object'
      ? job.payload.metadata as Record<string, unknown>
      : undefined;
    return adapter.send(this.context(job), { content, metadata });
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
