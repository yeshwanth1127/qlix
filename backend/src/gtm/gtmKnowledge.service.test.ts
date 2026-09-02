import assert from 'node:assert/strict';
import test from 'node:test';
import { isDocumentFresh } from '../aiBrain/brainDocumentReview.js';
import { GTM_SETUP_KNOWLEDGE_PURPOSES } from './gtmKnowledge.service.js';

test('GTM setup knowledge purposes exclude campaign learning collections', () => {
  assert.equal(GTM_SETUP_KNOWLEDGE_PURPOSES.length, 4);
  assert.ok(!GTM_SETUP_KNOWLEDGE_PURPOSES.includes('reviewed_market_learning'));
  assert.ok(!GTM_SETUP_KNOWLEDGE_PURPOSES.includes('customer_outcomes'));
});

test('freshness helper treats missing expiry as fresh', () => {
  assert.equal(isDocumentFresh(null), true);
  assert.equal(isDocumentFresh(undefined), true);
});

test('freshness helper rejects expired documents', () => {
  const past = new Date('2020-01-01T00:00:00.000Z');
  assert.equal(isDocumentFresh(past), false);
});
