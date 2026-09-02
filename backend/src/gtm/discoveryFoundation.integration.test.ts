import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { getDiscoveryFoundation } from './discoveryFoundation.service.js';

test('discovery foundation never projects another organization records', {
  skip: process.env.RUN_GTM_DB_TESTS !== '1' ? 'set RUN_GTM_DB_TESTS=1 for local database coverage' : false,
}, async () => {
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({ data: { name: 'GTM isolation A', slug: `gtm-isolation-a-${marker}` } }),
    prisma.organization.create({ data: { name: 'GTM isolation B', slug: `gtm-isolation-b-${marker}` } }),
  ]);
  try {
    await Promise.all([
      prisma.gtmIdea.create({ data: { orgId: orgA.id, version: 1, content: { idea: 'Idea A' }, createdBy: randomUUID() } }),
      prisma.gtmIdea.create({ data: { orgId: orgB.id, version: 1, content: { idea: 'Idea B' }, createdBy: randomUUID() } }),
    ]);
    const [foundationA, foundationB] = await Promise.all([
      getDiscoveryFoundation(orgA.id), getDiscoveryFoundation(orgB.id),
    ]);
    assert.equal((foundationA.idea?.content as { idea?: string }).idea, 'Idea A');
    assert.equal((foundationB.idea?.content as { idea?: string }).idea, 'Idea B');
  } finally {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
});
