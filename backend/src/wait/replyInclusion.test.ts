import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_REPLY_LABELS,
  DEFAULT_REPLY_INCLUSION,
  describeReplyInclusion,
  inferReplyInclusionFromGoal,
  normalizeReplyInclusion,
  replyIncluded,
} from './replyInclusion.js';

describe('inferReplyInclusionFromGoal', () => {
  it('defaults to engaged leads when the goal says nothing about who to record', () => {
    assert.deepEqual(
      inferReplyInclusionFromGoal('message the leads and put the replies in a sheet'),
      DEFAULT_REPLY_INCLUSION,
    );
  });

  it('defaults on empty input', () => {
    assert.deepEqual(inferReplyInclusionFromGoal(''), DEFAULT_REPLY_INCLUSION);
  });

  it('records everyone when the goal asks for every reply', () => {
    assert.deepEqual(
      inferReplyInclusionFromGoal('log every reply in the spreadsheet'),
      ALL_REPLY_LABELS,
    );
    assert.deepEqual(
      inferReplyInclusionFromGoal('put all responses into an excel sheet'),
      ALL_REPLY_LABELS,
    );
  });

  it('records everyone on explicit regardless-of-answer phrasing', () => {
    for (const goal of [
      'add them to the sheet regardless of interest',
      'sheet them whether or not they are interested',
      'track replies, interested or not',
      'collect the responses including declines',
      'log them even if they say no',
    ]) {
      assert.deepEqual(inferReplyInclusionFromGoal(goal), ALL_REPLY_LABELS, goal);
    }
  });

  it('narrows to declines when the goal asks only for the no replies', () => {
    for (const goal of [
      'put only the ones who said no in the sheet',
      'sheet only the declines',
      'record just the not interested leads',
    ]) {
      assert.deepEqual(inferReplyInclusionFromGoal(goal), ['not_interested'], goal);
    }
  });

  it('narrows to interested when the goal asks only for the yes replies', () => {
    for (const goal of [
      'put only the interested leads in the sheet',
      'sheet only the ones who said yes',
      'interested leads only in the excel file',
    ]) {
      assert.deepEqual(inferReplyInclusionFromGoal(goal), ['interested'], goal);
    }
  });

  it('treats a wait condition as timing, not a content rule', () => {
    // "once all replies are received" describes when to send, not who to record.
    assert.deepEqual(
      inferReplyInclusionFromGoal(
        'message the leads, then send me the sheet once all replies are received',
      ),
      DEFAULT_REPLY_INCLUSION,
    );
  });

  it('lets an explicit narrowing win over an unrelated "all"', () => {
    assert.deepEqual(
      inferReplyInclusionFromGoal(
        'collect all the details, but only sheet the interested leads',
      ),
      ['interested'],
    );
  });

  it('records everyone when the goal names both sides', () => {
    assert.deepEqual(
      inferReplyInclusionFromGoal('one sheet for only the interested and only the declined'),
      ALL_REPLY_LABELS,
    );
  });

  it('records everyone for the 1+1 pathway outreach goal', () => {
    const goal =
      'from the attached Excel file, find all leads from Bangalore. Send each lead a WhatsApp ' +
      'message asking whether they are interested in the 1+1 MS Data Science international ' +
      'pathway. If yes, explain the fees and duration, ask whether they prefer a brochure or ' +
      'counselor, then collect their city, degree, and experience. If no, thank them and stop ' +
      'the conversation. Wait up to 1 hour for replies, then put these replies in a clean excel ' +
      'sheets with all details collected and send it to me once all replies are recieved';
    assert.deepEqual(inferReplyInclusionFromGoal(goal), ALL_REPLY_LABELS);
  });
});

describe('normalizeReplyInclusion', () => {
  it('keeps valid labels and drops junk', () => {
    assert.deepEqual(
      normalizeReplyInclusion(['interested', 'nonsense', 'not_interested']),
      ['interested', 'not_interested'],
    );
  });

  it('dedupes', () => {
    assert.deepEqual(normalizeReplyInclusion(['unclear', 'unclear']), ['unclear']);
  });

  it('returns null for unusable values', () => {
    assert.equal(normalizeReplyInclusion([]), null);
    assert.equal(normalizeReplyInclusion(['bogus']), null);
    assert.equal(normalizeReplyInclusion('interested'), null);
    assert.equal(normalizeReplyInclusion(undefined), null);
  });
});

describe('replyIncluded', () => {
  it('applies the default policy when none is given', () => {
    assert.equal(replyIncluded('interested'), true);
    assert.equal(replyIncluded('unclear'), true);
    assert.equal(replyIncluded('not_interested'), false);
  });

  it('honours a declines-only policy', () => {
    assert.equal(replyIncluded('not_interested', ['not_interested']), true);
    assert.equal(replyIncluded('interested', ['not_interested']), false);
  });

  it('honours an everyone policy', () => {
    for (const label of ALL_REPLY_LABELS) {
      assert.equal(replyIncluded(label, ALL_REPLY_LABELS), true, label);
    }
  });
});

describe('describeReplyInclusion', () => {
  it('describes the default split', () => {
    assert.equal(
      describeReplyInclusion(DEFAULT_REPLY_INCLUSION),
      'record interested + unclear; leave out not interested',
    );
  });

  it('describes an everyone policy without an exclusion clause', () => {
    assert.equal(describeReplyInclusion(ALL_REPLY_LABELS), 'record every reply, whatever the answer');
  });

  it('describes a declines-only policy', () => {
    assert.equal(
      describeReplyInclusion(['not_interested']),
      'record not interested; leave out interested + unclear',
    );
  });
});
