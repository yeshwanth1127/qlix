import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clip } from './agentMemory.service.js';

describe('clip preserves durable artifacts', () => {
  it('keeps URLs when prose is truncated', () => {
    const url = 'https://docs.google.com/forms/d/e/1FAIpQLScTestForm/viewform';
    const prose = 'A'.repeat(580);
    const out = clip(`${prose} ${url}`, 600);
    assert.ok(out.includes(url));
    assert.ok(out.includes('[kept]:'));
  });

  it('keeps formId labels when truncated', () => {
    const prose = 'B'.repeat(580);
    const out = clip(`${prose} formId: abcdefghijklmnop`, 600);
    assert.ok(out.toLowerCase().includes('formid'));
    assert.ok(out.includes('abcdefghijklmnop'));
  });

  it('plain short text is unchanged', () => {
    assert.equal(clip('hello', 600), 'hello');
  });
});
