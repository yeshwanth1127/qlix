import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FOLLOW_UP_LABEL,
  FOLLOW_UP_NOTE_END,
  FOLLOW_UP_NOTE_START,
  applyTeamRunFollowUp,
  extractTeamRunUserGoal,
  firstInputsInContinueChain,
  firstRealGoalInContinueChain,
  isUnusableTeamSynthesis,
  lastResultFromEnvelope,
  pickUsableSynthesis,
  priorContextFromRun,
  resolveContinuedGoal,
} from './teamRunFollowUp.js';

describe('extractTeamRunUserGoal', () => {
  it('returns a plain goal unchanged', () => {
    assert.equal(extractTeamRunUserGoal('Find cafes in Pune'), 'Find cafes in Pune');
  });

  it('strips a previous-conversation envelope and returns the follow-up', () => {
    const wrapped = [
      FOLLOW_UP_NOTE_START,
      'Goal: Find cafes',
      'Result: Here is a list',
      FOLLOW_UP_NOTE_END,
      '',
      'Follow-up:',
      'Send the link again',
    ].join('\n');
    assert.equal(extractTeamRunUserGoal(wrapped), 'Send the link again');
  });

  it('strips attached-file dumps from the follow-up', () => {
    const wrapped = [
      FOLLOW_UP_NOTE_START,
      'Goal: Filter the sheet',
      FOLLOW_UP_NOTE_END,
      '',
      'Follow-up:',
      'Use column B',
      '',
      '---',
      'Attached files (1)',
      '### leads.xlsx (text/csv, 1 KB)',
      'Download: https://example.com/file',
    ].join('\n');
    assert.equal(extractTeamRunUserGoal(wrapped), 'Use column B');
  });
});

describe('applyTeamRunFollowUp / resolveContinuedGoal', () => {
  it('leaves the goal unchanged when there is no prior run', () => {
    assert.equal(resolveContinuedGoal('Do the next thing', null), 'Do the next thing');
  });

  it('prepends goal, synthesis, and user notes without nesting prior envelopes', () => {
    const priorGoal = [
      FOLLOW_UP_NOTE_START,
      'Goal: Original outreach',
      'Result: Old synthesis',
      FOLLOW_UP_NOTE_END,
      '',
      'Follow-up:',
      'Now filter Bangalore',
    ].join('\n');
    const note = applyTeamRunFollowUp('Send the brochure', {
      goal: priorGoal,
      synthesis: 'Kept 12 Bangalore leads. Form: https://docs.google.com/forms/d/e/1FAIpQLScKeepMe/viewform',
      errorMessage: null,
      userNotes: ['Skip the unpaid list', 'Also include Hyderabad aliases'],
    });

    assert.ok(note.startsWith(FOLLOW_UP_NOTE_START));
    assert.ok(note.includes('Intent: Now filter Bangalore'));
    assert.ok(!note.includes('Intent: Original outreach'));
    assert.equal(note.split(FOLLOW_UP_NOTE_START).length - 1, 1);
    assert.ok(note.includes('Result: Kept 12 Bangalore leads'));
    assert.ok(note.includes('https://docs.google.com/forms/d/e/1FAIpQLScKeepMe/viewform'));
    assert.ok(note.includes('- Skip the unpaid list'));
    assert.ok(note.includes(`${FOLLOW_UP_NOTE_END}\n\nFollow-up:\nSend the brochure`));
  });

  it('keeps URLs when the prior result is clipped', () => {
    const url = 'https://docs.google.com/spreadsheets/d/abc123xyz/edit';
    const note = applyTeamRunFollowUp('share the sheet', {
      goal: 'Build the sheet',
      synthesis: `${'A'.repeat(1400)} ${url}`,
      errorMessage: null,
      userNotes: [],
    });
    assert.ok(note.includes(url));
    assert.ok(note.includes('[kept]:'));
  });

  it('builds context from a run row and user_injection events', () => {
    const prior = priorContextFromRun(
      {
        goal: 'Find cafes',
        result: { synthesis: 'Three matches in Koregaon Park' },
        errorMessage: null,
      },
      [
        { eventType: 'run_started', payload: {} },
        { eventType: 'user_injection', payload: { message: 'Prefer walkable spots' } },
        { eventType: 'user_injection', payload: { message: '  ' } },
      ],
    );
    const wrapped = resolveContinuedGoal('Email me the list', prior);
    assert.ok(wrapped.includes('Intent: Find cafes'));
    assert.ok(wrapped.includes('Three matches in Koregaon Park'));
    assert.ok(wrapped.includes('- Prefer walkable spots'));
    assert.ok(!wrapped.includes('user_injection'));
  });

  it('uses errorMessage when there is no synthesis', () => {
    const note = applyTeamRunFollowUp('try again', {
      goal: 'Draft outreach',
      synthesis: null,
      errorMessage: 'Pipeline aborted: outreach stage failed',
      userNotes: [],
    });
    assert.ok(note.includes('Result: Pipeline aborted: outreach stage failed'));
  });

  it('keeps the original intent as the retry summary and working follow-up', () => {
    const original =
      'read the file, filter leads by city, bangalore, then send a whatsapp greeting, brochure, and poll';
    const note = applyTeamRunFollowUp('try again', {
      goal: original,
      synthesis: null,
      errorMessage: 'Pipeline aborted: stage "Lead Filter" failed',
      userNotes: [],
    });
    assert.ok(note.includes(`Intent: ${original}`));
    assert.ok(note.includes(`${FOLLOW_UP_LABEL}\n${original}`));
    assert.ok(!note.includes(`${FOLLOW_UP_LABEL}\ntry again`));
    assert.equal(extractTeamRunUserGoal(note), original);
  });

  it('resolves a try-again envelope back to the stored intent', () => {
    const original = 'filter leads by city, bangalore, then message them on WhatsApp';
    const wrapped = [
      FOLLOW_UP_NOTE_START,
      `Goal: ${original}`,
      'Result: Pipeline aborted',
      FOLLOW_UP_NOTE_END,
      '',
      'Follow-up:',
      'try again',
    ].join('\n');
    assert.equal(extractTeamRunUserGoal(wrapped), original);
  });

  it('recognizes do-it-again as a repeat of the complete original intent', () => {
    const original =
      'filter Bangalore leads, send a greeting, Brain brochure and poll, collect replies in Excel';
    const note = applyTeamRunFollowUp('do it again', {
      goal: original,
      synthesis: 'Prior run completed',
      errorMessage: null,
      userNotes: [],
    });
    assert.equal(extractTeamRunUserGoal(note), original);
  });
});

describe('firstInputsInContinueChain', () => {
  it('walks past empty follow-ups to the original attached file', () => {
    const inputs = firstInputsInContinueChain([
      { inputs: [] },
      { inputs: [] },
      {
        inputs: [
          {
            id: 'sheet',
            ref: 'team-input:sheet',
            fileName: 'Sample.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            url: 'sandbox://sheet',
            sizeBytes: 1,
            sha256: 'abc',
            purpose: 'authoritative_input',
            extractedText: 'Name,City\nAarav,Bangalore',
          },
        ],
      },
    ]);
    assert.equal(inputs[0]?.fileName, 'Sample.xlsx');
  });

  it('returns empty when no ancestor has inputs', () => {
    assert.deepEqual(firstInputsInContinueChain([{ inputs: [] }, { inputs: [] }]), []);
  });
});

describe('firstRealGoalInContinueChain', () => {
  it('skips try-again follow-ups to the original objective', () => {
    const goal = firstRealGoalInContinueChain([
      { goal: 'try again' },
      {
        goal: [
          FOLLOW_UP_NOTE_START,
          'Goal: try again',
          FOLLOW_UP_NOTE_END,
          '',
          'Follow-up:',
          'try again',
        ].join('\n'),
      },
      { goal: 'read the file, filter leads by city, bangalore, then send WhatsApp' },
    ]);
    assert.match(goal, /bangalore/i);
  });

  it('prefers the root draft over a later create-pdf follow-up', () => {
    const pdfContinue = [
      FOLLOW_UP_NOTE_START,
      'Intent: draft a small opening scene',
      'Result: {"draft":"FADE IN"}',
      FOLLOW_UP_NOTE_END,
      '',
      'Follow-up:',
      'create a pdf for this',
    ].join('\n');
    const goal = firstRealGoalInContinueChain([
      { goal: pdfContinue },
      { goal: 'draft a small opening scene for a thriller about a missing train' },
    ]);
    assert.match(goal, /missing train/i);
  });
});

describe('lastResultFromEnvelope / unusable synthesis', () => {
  it('captures multiline Result JSON', () => {
    const goal = [
      FOLLOW_UP_NOTE_START,
      'Intent: draft',
      'Result: {',
      '  "draft": "FADE IN",',
      '  "status": "ok"',
      '}',
      FOLLOW_UP_NOTE_END,
      '',
      'Follow-up:',
      'create a pdf for this',
    ].join('\n');
    const result = lastResultFromEnvelope(goal);
    assert.ok(result);
    assert.match(result!, /FADE IN/);
    assert.match(result!, /"status": "ok"/);
  });

  it('detects blocked PDF failure JSON as unusable', () => {
    const blocked = JSON.stringify({
      reason: "Dispatch says 'create a pdf for this' but provides no attached source",
      status: 'blocked',
      needed_to_proceed: ['Attach the source'],
    });
    assert.equal(isUnusableTeamSynthesis(blocked), true);
    assert.equal(isUnusableTeamSynthesis('{"draft":"FADE IN"}'), false);
  });

  it('pickUsableSynthesis skips blocked and returns the draft', () => {
    const blocked = '{"status":"blocked","reason":"no pdf tool"}';
    const draft = '{"draft":"FADE IN"}';
    assert.equal(pickUsableSynthesis([blocked, draft]), draft);
  });
});
