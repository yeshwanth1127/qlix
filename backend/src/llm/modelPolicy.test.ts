import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQlixInferenceModelId } from './modelPolicy.js';

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
});
