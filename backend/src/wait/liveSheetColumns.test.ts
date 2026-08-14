import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveLiveSheetField } from './liveSheetColumns.js';

describe('resolveLiveSheetField', () => {
  it('maps common header variants', () => {
    assert.equal(resolveLiveSheetField('Lead name'), 'name');
    assert.equal(resolveLiveSheetField('Mobile'), 'phone');
    assert.equal(resolveLiveSheetField('Response'), 'reply');
    assert.equal(resolveLiveSheetField('Sentiment'), 'interest');
    assert.equal(resolveLiveSheetField('Replied at'), 'repliedAt');
    assert.equal(resolveLiveSheetField('Reply Time'), 'repliedAt');
  });
});

describe('inferNameFromOutreachMessage', () => {
  it('extracts greeting names', async () => {
    const { inferNameFromOutreachMessage } = await import('./liveSheetColumns.js');
    assert.equal(
      inferNameFromOutreachMessage('Hi Karthik, just checking in!'),
      'Karthik',
    );
    assert.equal(
      inferNameFromOutreachMessage('Hi Rohan Mehta, hope you are well.'),
      'Rohan Mehta',
    );
  });
});
