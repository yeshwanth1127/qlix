import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyReplyInterestByKeywords,
  formatInterestFindings,
  INTEREST_STAGE_GOAL_MARKER,
  interestStageGoalAppend,
  shouldIncludeOnSheet,
  summarizeInterestCounts,
  type InterestLabel,
  type ReplyInterestResult,
} from './replyInterestClassifier.js';

function sampleRows(): ReplyInterestResult[] {
  return [
    { jid: '9180@s.whatsapp.net', text: 'yes', label: 'interested', reason: 'exact', method: 'keyword' },
    { jid: '9181@s.whatsapp.net', text: 'stop', label: 'not_interested', reason: 'exact', method: 'keyword' },
    { jid: '9182@s.whatsapp.net', text: 'maybe', label: 'unclear', reason: 'llm', method: 'llm' },
  ];
}

describe('classifyReplyInterestByKeywords', () => {
  it('marks clear affirmatives as interested', () => {
    for (const text of ['yes', 'Yep!', 'sure', 'OK', 'interested', 'tell me more']) {
      const result = classifyReplyInterestByKeywords(text);
      assert.equal(result?.label, 'interested', text);
      assert.equal(result?.method, 'keyword');
    }
  });

  it('marks clear declines as not_interested', () => {
    for (const text of [
      'no',
      'Nope',
      'not interested',
      'stop',
      'unsubscribe',
      'wrong number',
      "don't contact me",
    ]) {
      const result = classifyReplyInterestByKeywords(text);
      assert.equal(result?.label, 'not_interested', text);
      assert.equal(result?.method, 'keyword');
    }
  });

  it('returns null for ambiguous replies that need the LLM', () => {
    for (const text of ['maybe later', 'who is this?', 'hi', 'what is this about?']) {
      assert.equal(classifyReplyInterestByKeywords(text), null, text);
    }
  });

  it('treats empty replies as unclear via keywords', () => {
    const result = classifyReplyInterestByKeywords('   ');
    assert.equal(result?.label, 'unclear');
  });
});

describe('sheet inclusion policy', () => {
  it('includes interested and unclear; excludes not_interested', () => {
    assert.equal(shouldIncludeOnSheet('interested'), true);
    assert.equal(shouldIncludeOnSheet('unclear'), true);
    assert.equal(shouldIncludeOnSheet('not_interested'), false);
  });

  it('formats findings with included and excluded sections', () => {
    const rows: ReplyInterestResult[] = [
      {
        jid: '9180@s.whatsapp.net',
        text: 'yes',
        label: 'interested',
        reason: 'exact',
        method: 'keyword',
      },
      {
        jid: '9181@s.whatsapp.net',
        text: 'stop',
        label: 'not_interested',
        reason: 'exact',
        method: 'keyword',
      },
      {
        jid: '9182@s.whatsapp.net',
        text: 'maybe',
        label: 'unclear',
        reason: 'llm',
        method: 'llm',
      },
    ];
    const findings = formatInterestFindings(rows);
    assert.match(findings, /Included leads/);
    assert.match(findings, /9180@s\.whatsapp\.net/);
    assert.match(findings, /9182@s\.whatsapp\.net/);
    assert.match(findings, /Excluded leads/);
    assert.match(findings, /9181@s\.whatsapp\.net/);
    const counts = summarizeInterestCounts(rows);
    assert.deepEqual(counts, {
      interested: 1,
      notInterested: 1,
      unclear: 1,
      included: 2,
    });
  });

  it('follows a record-everyone policy', () => {
    const rows = sampleRows();
    const everyone: InterestLabel[] = ['interested', 'unclear', 'not_interested'];
    for (const label of everyone) {
      assert.equal(shouldIncludeOnSheet(label, everyone), true, label);
    }
    const findings = formatInterestFindings(rows, everyone);
    assert.match(findings, /record every reply/);
    assert.match(findings, /Excluded leads[\s\S]*\(none\)/);
    assert.equal(summarizeInterestCounts(rows, everyone).included, 3);
  });

  it('follows a declines-only policy', () => {
    const rows = sampleRows();
    const declinesOnly: InterestLabel[] = ['not_interested'];
    assert.equal(shouldIncludeOnSheet('not_interested', declinesOnly), true);
    assert.equal(shouldIncludeOnSheet('interested', declinesOnly), false);
    const findings = formatInterestFindings(rows, declinesOnly);
    assert.match(findings, /Included leads[\s\S]*9181@s\.whatsapp\.net/);
    assert.equal(summarizeInterestCounts(rows, declinesOnly).included, 1);
  });

  it('states the active policy in the resumed stage instruction', () => {
    assert.match(
      interestStageGoalAppend(['interested', 'unclear', 'not_interested']),
      /record every reply/,
    );
    assert.match(interestStageGoalAppend(['not_interested']), /leave out interested \+ unclear/);
    assert.ok(interestStageGoalAppend().startsWith(INTEREST_STAGE_GOAL_MARKER));
  });
});
