import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { providerForModel } from './inferenceRouter.js';

describe('providerForModel', () => {
  it('reads the provider off a qualified model id', () => {
    assert.equal(providerForModel('exora/exora-general'), 'exora');
    assert.equal(providerForModel('openrouter/openai/gpt-4o-mini'), 'openrouter');
    assert.equal(providerForModel('openrouter/qlix/auto'), 'openrouter');
  });

  it('ignores case and surrounding whitespace', () => {
    assert.equal(providerForModel('  OpenRouter/OpenAI/GPT-4o-mini  '), 'openrouter');
    assert.equal(providerForModel('EXORA/exora-general'), 'exora');
  });

  it('returns null when there is nothing to read, so callers use their own default', () => {
    assert.equal(providerForModel(''), null);
    assert.equal(providerForModel('   '), null);
    assert.equal(providerForModel(null), null);
    assert.equal(providerForModel(undefined), null);
    assert.equal(providerForModel('gpt-4o-mini'), null, 'unprefixed model is ambiguous');
  });
});
