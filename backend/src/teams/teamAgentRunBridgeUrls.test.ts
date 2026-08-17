import assert from 'node:assert/strict';
import test from 'node:test';
import { collectToolUrls } from './teamAgentRunBridge.js';

test('URLs are harvested from any shape a tool reports them in', () => {
  // The research tool nests them under `sources`; nothing here knows that.
  const fromSources = collectToolUrls(
    {
      ok: true,
      tool: 'research_web_search',
      sources: [
        { url: 'https://uk.linkedin.com/in/brenthoberman', title: 'linkedin' },
        { url: 'https://stackedreview.com/saas-cac-ltv-statistics/' },
      ],
    },
    new Set(),
  );
  assert.equal(fromSources.size, 2);
  assert.ok(fromSources.has('https://uk.linkedin.com/in/brenthoberman'));

  // A different tool inlining a URL in free text is captured just the same.
  const fromText = collectToolUrls({ result: 'see https://example.com/report for detail' }, new Set());
  assert.deepEqual([...fromText], ['https://example.com/report']);

  // And one returning a bare array of strings.
  assert.equal(collectToolUrls(['https://a.test', 'https://b.test'], new Set()).size, 2);
});

test('harvesting is bounded and never throws on odd payloads', () => {
  for (const odd of [null, undefined, 0, false, '', {}, []]) {
    assert.equal(collectToolUrls(odd, new Set()).size, 0);
  }
  // Deeply nested beyond the depth bound is ignored rather than walked forever.
  let deep: unknown = 'https://deep.test';
  for (let i = 0; i < 12; i++) deep = { nested: deep };
  assert.equal(collectToolUrls(deep, new Set()).size, 0);

  // Self-referencing objects must not hang the bridge.
  const cyclic: Record<string, unknown> = { url: 'https://cyclic.test' };
  cyclic.self = cyclic;
  assert.ok(collectToolUrls(cyclic, new Set()).has('https://cyclic.test'));
});

test('trailing punctuation is not swallowed into the URL', () => {
  const urls = collectToolUrls({ text: 'source: (https://example.com/a) and "https://example.com/b"' }, new Set());
  assert.deepEqual([...urls].sort(), ['https://example.com/a', 'https://example.com/b']);
});
