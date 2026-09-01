import assert from 'node:assert/strict';
import test from 'node:test';
import { formatContextRef, linkContextEdge, parseContextRef } from './contextPlane.service.js';

test('context references are opaque, versioned, and hash-bound', () => {
  const hash = 'a'.repeat(64);
  const ref = formatContextRef('cm123abc', 3, hash);
  assert.equal(ref, 'ctx:cm123abc:v3:aaaaaaaaaaaa');
  assert.deepEqual(parseContextRef(ref), { id: 'cm123abc', version: 3, hashPrefix: 'aaaaaaaaaaaa' });
});

test('context reference parser fails closed', () => {
  assert.throws(() => parseContextRef('team-result:123'), /Invalid context reference/);
});

test('unsupported context edge relations fail closed', async () => {
  await assert.rejects(
    () => linkContextEdge({ orgId: 'org', fromObjectId: 'a', toObjectId: 'b', relation: 'copy' as 'supersedes' }),
    /Unsupported context edge relation/,
  );
});

