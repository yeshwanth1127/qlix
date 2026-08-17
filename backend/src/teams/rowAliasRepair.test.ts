import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalCity, cityAliasHint, sameCity } from './cityAliases.js';
import { parseDelimitedRows, repairCityAliasOmissions } from './rowAliasRepair.js';

const sheet = {
  ref: 'team-input:2a9a5686',
  fileName: '3_people_india.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  extractedText:
    'Name,Phone Number,City\n' +
    'Aarav Sharma,8095404788,Delhi\n' +
    'Raghu Vamsi,8105199337,Bangalore\n' +
    'Hemila,8073920076,Bengaluru',
};

function payloadWith(leads: Array<Record<string, unknown>>, recordRefs: string[]) {
  return {
    summary: 'Filtered leads',
    findings: { leads },
    provenance: { inputRefs: [sheet.ref], recordRefs, knowledgeRefs: [] },
  };
}

test('alias spellings resolve to one city', () => {
  assert.equal(canonicalCity('Bengaluru'), canonicalCity(' bangalore '));
  assert.ok(sameCity('BLR', 'Bengaluru'));
  assert.ok(sameCity('Bombay', 'mumbai'));
  assert.ok(!sameCity('Delhi', 'Bangalore'));
  assert.ok(!sameCity('', 'Bangalore'));
});

test('the filter hint names the spellings actually at stake', () => {
  const hint = cityAliasHint('find all leads from Bangalore and message them');
  assert.match(hint, /Bengaluru/);
  assert.match(hint, /same city/);
  assert.equal(cityAliasHint('find all leads from Indore'), '');
});

test('quoted cells survive parsing', () => {
  const parsed = parseDelimitedRows('Name,City\n"Vamsi, R",Bengaluru\n');
  assert.deepEqual(parsed?.header, ['Name', 'City']);
  assert.deepEqual(parsed?.rows, [['Vamsi, R', 'Bengaluru']]);
});

test('a row dropped only for its city spelling is restored from the source', () => {
  const repair = repairCityAliasOmissions({
    payload: payloadWith(
      [{ Name: 'Raghu Vamsi', Phone: '+918105199337', City: 'Bangalore' }],
      ['2a9a5686:row:2'],
    ),
    inputs: [sheet],
  });
  assert.equal(repair.restored.length, 1);
  assert.equal(repair.restored[0]!.label, 'Hemila');
  assert.equal(repair.restored[0]!.city, 'Bengaluru');
  const leads = (repair.payload as { findings: { leads: Record<string, unknown>[] } }).findings.leads;
  assert.deepEqual(leads[1], {
    Name: 'Hemila',
    // The country code the worker added to the kept lead is reapplied, not invented.
    Phone: '+918073920076',
    City: 'Bengaluru',
  });
  const provenance = (repair.payload as { provenance: { recordRefs: string[] } }).provenance;
  assert.deepEqual(provenance.recordRefs, ['2a9a5686:row:2', '2a9a5686:row:3']);
});

test('rows dropped on some other criterion are left alone', () => {
  // Same spelling as a kept row means the stage rejected it for a reason we cannot see.
  const withTwoBangalore = {
    ...sheet,
    extractedText:
      'Name,Phone Number,City,Degree\n' +
      'Raghu Vamsi,8105199337,Bangalore,MSc\n' +
      'Other Person,8105199338,Bangalore,BSc',
  };
  const repair = repairCityAliasOmissions({
    payload: payloadWith([{ Name: 'Raghu Vamsi', Phone: '8105199337', City: 'Bangalore' }], [
      '2a9a5686:row:1',
    ]),
    inputs: [withTwoBangalore],
  });
  assert.deepEqual(repair.restored, []);
});

test('a different city is never pulled in', () => {
  const repair = repairCityAliasOmissions({
    payload: payloadWith([{ Name: 'Aarav Sharma', Phone: '8095404788', City: 'Delhi' }], [
      '2a9a5686:row:1',
    ]),
    inputs: [sheet],
  });
  assert.deepEqual(repair.restored, []);
});

test('an unrecognised payload or source is returned untouched', () => {
  const prose = { payload: 'no envelope here', inputs: [sheet] };
  assert.deepEqual(repairCityAliasOmissions(prose), { payload: 'no envelope here', restored: [] });

  const noCityColumn = { ...sheet, extractedText: 'Name,Phone\nHemila,8073920076' };
  const payload = payloadWith([{ Name: 'Hemila', Phone: '8073920076' }], ['2a9a5686:row:1']);
  assert.deepEqual(
    repairCityAliasOmissions({ payload, inputs: [noCityColumn] }),
    { payload, restored: [] },
  );

  const pdf = { ...sheet, fileName: 'deck.pdf', mimeType: 'application/pdf' };
  assert.deepEqual(
    repairCityAliasOmissions({ payload, inputs: [pdf] }),
    { payload, restored: [] },
  );
});
