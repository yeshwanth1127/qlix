import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NLParseError, parsePlanningToolArguments } from './nlParse.js';

describe('parsePlanningToolArguments', () => {
  it('parses normal tool arguments', () => {
    assert.deepEqual(parsePlanningToolArguments('{"agent":{"name":"Lead Qualifier"}}'), {
      agent: { name: 'Lead Qualifier' },
    });
  });

  it('recovers fenced and double-encoded tool arguments', () => {
    assert.deepEqual(parsePlanningToolArguments('```json\n{"type":"team"}\n```'), {
      type: 'team',
    });
    assert.deepEqual(parsePlanningToolArguments('"{\\"type\\":\\"single\\"}"'), {
      type: 'single',
    });
  });

  it('rejects irrecoverable output so the caller can request one repair', () => {
    assert.throws(() => parsePlanningToolArguments('\\'), NLParseError);
  });
});
