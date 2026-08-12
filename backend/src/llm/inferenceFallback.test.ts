import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InferenceProviderError } from './providers/types.js';
import {
  isTransientInferenceFailure,
  openrouterFallbackModel,
} from './inferenceFallback.js';

describe('isTransientInferenceFailure', () => {
  it('treats Exora HTTP 502 as transient', () => {
    assert.equal(
      isTransientInferenceFailure(new InferenceProviderError('exora', 502, 'HTTP 502')),
      true,
    );
  });

  it('does not retry auth failures', () => {
    assert.equal(
      isTransientInferenceFailure(new InferenceProviderError('exora', 401, 'unauthorized')),
      false,
    );
  });

  it('treats timeouts as transient', () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    assert.equal(isTransientInferenceFailure(abort), true);
  });
});

describe('openrouterFallbackModel', () => {
  it('maps Exora home models onto gpt-4o-mini', () => {
    assert.equal(openrouterFallbackModel('exora/exora-general'), 'openrouter/openai/gpt-4o-mini');
  });
});
