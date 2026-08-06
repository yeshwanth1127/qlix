import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveOpenRouterApiModel } from './resolveOpenRouterModel.js';

describe('resolveOpenRouterApiModel', () => {
  it('maps qlix/auto to a concrete OpenRouter id', () => {
    const id = resolveOpenRouterApiModel({
      model: 'openrouter/qlix/auto',
      messages: [{ role: 'user', content: 'Build me a sales agent' }],
      tools: [{ type: 'function', function: { name: 'plan_single_agent' } }],
    });
    assert.ok(id !== 'qlix/auto');
    assert.match(id, /^(google|openai|anthropic|meta-llama|mistralai|qwen)\//);
  });

  it('passes pinned models through', () => {
    const id = resolveOpenRouterApiModel({
      model: 'openrouter/openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(id, 'openai/gpt-4o-mini');
  });
});
