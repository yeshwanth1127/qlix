import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openAiChatCompletionsRequestSchema } from './inferenceSchemas.js';

describe('openAiChatCompletionsRequestSchema', () => {
  it('accepts vision-style message content arrays', () => {
    const parsed = openAiChatCompletionsRequestSchema.safeParse({
      model: 'openai/gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is on screen?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ],
    });
    assert.equal(parsed.success, true);
  });

  it('rejects streaming requests at route layer (schema allows stream flag)', () => {
    const parsed = openAiChatCompletionsRequestSchema.safeParse({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.stream, true);
  });
});
