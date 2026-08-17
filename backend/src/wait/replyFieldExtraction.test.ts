import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractReplyFields, parseExtractedFields } from './replyFieldExtraction.js';

const COLUMNS = ['City', 'Degree', 'Experience'];

describe('parseExtractedFields', () => {
  it('reads a clean JSON object', () => {
    assert.deepEqual(
      parseExtractedFields('{"City":"Bangalore","Degree":"B.Tech","Experience":"3 years"}', COLUMNS),
      { City: 'Bangalore', Degree: 'B.Tech', Experience: '3 years' },
    );
  });

  it('reads JSON wrapped in prose or a code fence', () => {
    assert.deepEqual(
      parseExtractedFields('Here you go:\n```json\n{"City":"Pune"}\n```', COLUMNS),
      { City: 'Pune' },
    );
  });

  it('omits fields the message did not answer', () => {
    assert.deepEqual(
      parseExtractedFields('{"City":"Delhi","Degree":null,"Experience":null}', COLUMNS),
      { City: 'Delhi' },
    );
  });

  it('drops null-ish prose instead of writing it into a cell', () => {
    for (const value of ['not mentioned', 'N/A', 'unknown', 'none', 'not provided', '']) {
      assert.deepEqual(
        parseExtractedFields(JSON.stringify({ City: value }), COLUMNS),
        {},
        `should drop ${JSON.stringify(value)}`,
      );
    }
  });

  it('matches column names loosely on case and punctuation', () => {
    assert.deepEqual(
      parseExtractedFields('{"city":"Bangalore","years_of_experience":"3"}', [
        'City',
        'Years of experience',
      ]),
      { City: 'Bangalore', 'Years of experience': '3' },
    );
  });

  it('ignores keys that were never requested', () => {
    assert.deepEqual(
      parseExtractedFields('{"City":"Bangalore","Salary":"20 LPA"}', COLUMNS),
      { City: 'Bangalore' },
    );
  });

  it('coerces numbers and booleans to strings', () => {
    assert.deepEqual(parseExtractedFields('{"Experience":3}', COLUMNS), { Experience: '3' });
  });

  it('caps very long values', () => {
    const long = 'x'.repeat(500);
    const out = parseExtractedFields(JSON.stringify({ City: long }), COLUMNS);
    assert.equal(out.City?.length, 120);
  });

  it('returns nothing for unparseable responses', () => {
    assert.deepEqual(parseExtractedFields('I could not find anything', COLUMNS), {});
    assert.deepEqual(parseExtractedFields('{not json}', COLUMNS), {});
    assert.deepEqual(parseExtractedFields('', COLUMNS), {});
  });

  it('salvages the object when a model wraps it in an array', () => {
    assert.deepEqual(parseExtractedFields('[{"City":"Bangalore"}]', COLUMNS), {
      City: 'Bangalore',
    });
  });
});

describe('extractReplyFields short-circuits', () => {
  it('makes no model call when there are no custom columns', async () => {
    assert.deepEqual(await extractReplyFields({ columns: [], text: 'Bangalore' }), {});
  });

  it('makes no model call when the reply is blank', async () => {
    assert.deepEqual(await extractReplyFields({ columns: COLUMNS, text: '   ' }), {});
  });

  it('makes no model call when every column is already filled', async () => {
    assert.deepEqual(
      await extractReplyFields({
        columns: ['City', 'Degree'],
        text: 'Bangalore, B.Tech',
        known: { City: 'Bangalore', Degree: 'B.Tech' },
      }),
      {},
    );
  });
});
