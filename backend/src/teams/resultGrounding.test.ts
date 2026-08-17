import assert from 'node:assert/strict';
import test from 'node:test';
import { groundingPaths, groundingViolations, normalizeUrl, valuesAtPath } from './resultGrounding.js';

/** Plain substring comparator — the domain-aware one lives in lunaTeamsHost. */
const contains = (source: string, _key: string, value: string | number) =>
  source.toLowerCase().includes(String(value).toLowerCase());

const check = (payload: unknown, contract: unknown, givenText = '', toolUrls: string[] = []) =>
  groundingViolations({
    payload,
    paths: groundingPaths(contract),
    givenText,
    toolUrls: new Set(toolUrls),
    contains,
  });

test('a contract with no annotations declares nothing', () => {
  const paths = groundingPaths({
    type: 'object',
    properties: { summary: { type: 'string' }, findings: {} },
  });
  assert.equal(paths.size, 0);
});

test('annotations are collected as canonical payload paths', () => {
  const paths = groundingPaths({
    type: 'object',
    properties: {
      findings: {
        type: 'object',
        properties: {
          people: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', grounding: 'input' },
                evidence: {
                  type: 'array',
                  items: { type: 'object', properties: { sourceUrl: { grounding: 'tool' } } },
                },
                note: { type: 'string', grounding: 'derived' },
              },
            },
          },
        },
      },
    },
  });

  assert.deepEqual([...paths.entries()].sort(), [
    ['findings.people[].evidence[].sourceUrl', 'tool'],
    ['findings.people[].name', 'input'],
    ['findings.people[].note', 'derived'],
  ]);
});

test('paths resolve through nested arrays with concrete indices', () => {
  const found = valuesAtPath(
    { findings: { people: [{ name: 'A' }, { name: 'B' }] } },
    'findings.people[].name',
  );
  assert.deepEqual(found, [
    { value: 'A', path: 'findings.people[0].name' },
    { value: 'B', path: 'findings.people[1].name' },
  ]);
});

const peopleContract = {
  type: 'object',
  properties: {
    findings: {
      type: 'object',
      properties: {
        people: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', grounding: 'input' },
              sourceUrl: { type: 'string', grounding: 'tool' },
              assessment: { type: 'string', grounding: 'derived' },
            },
          },
        },
      },
    },
  },
};

test('a subject absent from everything given is a violation', () => {
  const violations = check(
    { findings: { people: [{ name: 'Brent Hoberman' }] } },
    peopleContract,
    'THE TEAM\nYeshwanth SH — Founder',
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /findings\.people\[0\]\.name/);
  assert.match(violations[0]!, /not in anything this dispatch was given/);
});

test('a subject present in what was given passes', () => {
  assert.deepEqual(
    check(
      { findings: { people: [{ name: 'Yeshwanth SH' }] } },
      peopleContract,
      'THE TEAM\nYeshwanth SH — Founder',
    ),
    [],
  );
});

test('a citation no tool returned is a violation, one it did returns clean', () => {
  const payload = { findings: { people: [{ sourceUrl: 'https://sohailprasad.com/' }] } };
  assert.match(check(payload, peopleContract, '', ['https://uk.linkedin.com/in/brenthoberman'])[0]!, /was not returned by any tool/);
  assert.deepEqual(check(payload, peopleContract, '', ['https://sohailprasad.com']), []);
});

test('derived fields are never checked', () => {
  assert.deepEqual(
    check({ findings: { people: [{ assessment: 'entirely invented judgement' }] } }, peopleContract),
    [],
  );
});

test('absent and empty values are not violations', () => {
  // Nothing to trace is not the same as something untraceable.
  assert.deepEqual(check({ findings: { people: [{ name: '  ' }, {}] } }, peopleContract, ''), []);
  assert.deepEqual(check({ findings: {} }, peopleContract, ''), []);
  assert.deepEqual(check({}, peopleContract, ''), []);
});

test('URLs compare by their meaningful parts', () => {
  assert.equal(normalizeUrl('https://WWW.Example.com/a/'), normalizeUrl('http://example.com/A'));
  assert.notEqual(normalizeUrl('https://example.com/a'), normalizeUrl('https://example.com/b'));
});

test('a tool-grounded field with no tool URLs at all is a violation', () => {
  // A dispatch that cites a source without having called anything has invented it.
  const violations = check(
    { findings: { people: [{ sourceUrl: 'https://example.com' }] } },
    peopleContract,
    '',
    [],
  );
  assert.equal(violations.length, 1);
});

test('malformed contracts are ignored rather than throwing', () => {
  for (const contract of [null, undefined, 'text', [], { properties: 'not an object' }]) {
    assert.equal(groundingPaths(contract).size, 0);
  }
  assert.deepEqual(check({ findings: {} }, { properties: { findings: { grounding: 'nonsense' } } }), []);
});
