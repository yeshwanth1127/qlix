import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TELEGRAM_MAX_MESSAGE_LENGTH,
  chunkTelegramText,
} from './telegram.adapter.js';

describe('chunkTelegramText', () => {
  it('returns short text as a single chunk', () => {
    assert.deepEqual(chunkTelegramText('hello'), ['hello']);
  });

  it('splits at newlines near the limit', () => {
    const a = 'a'.repeat(100);
    const b = 'b'.repeat(100);
    const text = `${a}\n${b}`;
    const chunks = chunkTelegramText(text, 120);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0], a);
    assert.equal(chunks[1], b);
  });

  it('keeps each chunk within maxLen', () => {
    const text = 'x'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH * 2 + 50);
    const chunks = chunkTelegramText(text);
    assert.ok(chunks.length >= 3);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= TELEGRAM_MAX_MESSAGE_LENGTH);
    }
    assert.equal(chunks.join(''), text);
  });
});
