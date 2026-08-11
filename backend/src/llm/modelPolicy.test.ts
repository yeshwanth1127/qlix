import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertModelAllowed,
  llmProviderFromModelId,
  ModelPolicyError,
  normalizeQlixInferenceModelId,
} from './modelPolicy.js';

describe('normalizeQlixInferenceModelId', () => {
  it('prefixes bare model ids', () => {
    assert.equal(normalizeQlixInferenceModelId('gpt-4o-mini'), 'openrouter/gpt-4o-mini');
  });

  it('prefixes provider/model ids from gui-agents', () => {
    assert.equal(
      normalizeQlixInferenceModelId('openai/gpt-4o'),
      'openrouter/openai/gpt-4o',
    );
  });

  it('leaves canonical openrouter ids unchanged', () => {
    assert.equal(
      normalizeQlixInferenceModelId('openrouter/openai/gpt-4o-mini'),
      'openrouter/openai/gpt-4o-mini',
    );
  });

  it('normalizes bare Exora aliases with the selected provider', () => {
    assert.equal(
      normalizeQlixInferenceModelId('exora-general', 'exora'),
      'exora/exora-general',
    );
  });

  it('leaves canonical Exora ids unchanged', () => {
    assert.equal(
      normalizeQlixInferenceModelId('exora/exora-general', 'exora'),
      'exora/exora-general',
    );
  });
});

describe('assertModelAllowed cross-provider overrides', () => {
  it('allows openrouter models even when the agent home provider is exora', () => {
    assert.doesNotThrow(() =>
      assertModelAllowed('openrouter/openai/gpt-4o-mini', 'exora'),
    );
  });

  it('allows exora models even when the agent home provider is openrouter', () => {
    assert.doesNotThrow(() => assertModelAllowed('exora/exora-general', 'openrouter'));
  });

  it('still rejects models outside the resolved namespace prefixes', () => {
    assert.throws(
      () => assertModelAllowed('anthropic/claude-sonnet-4.6', 'exora'),
      ModelPolicyError,
    );
  });
});

describe('llmProviderFromModelId', () => {
  it('maps namespaces', () => {
    assert.equal(llmProviderFromModelId('exora/exora-general'), 'exora');
    assert.equal(llmProviderFromModelId('openrouter/openai/gpt-4o-mini'), 'openrouter');
  });
});
