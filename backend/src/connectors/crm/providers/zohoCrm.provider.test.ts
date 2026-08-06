import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractZohoArray, isZohoRecordId, normalizeCoqlQuery } from './zohoCrm.provider.js';

const MODULES = [{ apiName: 'Leads', label: 'Lead', pluralLabel: 'Leads' }];

describe('normalizeCoqlQuery', () => {
  it('adds WHERE before LIMIT when missing', () => {
    assert.equal(
      normalizeCoqlQuery('SELECT id FROM Leads LIMIT 5', MODULES),
      'SELECT id FROM Leads where id is not null LIMIT 5',
    );
  });

  it('adds WHERE before ORDER BY when missing', () => {
    assert.equal(
      normalizeCoqlQuery('SELECT id FROM Leads ORDER BY Created_Time DESC', MODULES),
      'SELECT id FROM Leads where id is not null ORDER BY Created_Time DESC',
    );
  });

  it('adds WHERE at end for bare SELECT', () => {
    assert.equal(
      normalizeCoqlQuery('SELECT COUNT(id) FROM Leads', MODULES),
      'SELECT COUNT(id) FROM Leads where id is not null',
    );
  });

  it('uppercases count() and replaces COUNT(*)', () => {
    assert.equal(
      normalizeCoqlQuery('select count(id) from Leads', MODULES),
      'select COUNT(id) from Leads where id is not null',
    );
    assert.equal(
      normalizeCoqlQuery('SELECT COUNT(*) FROM Leads', MODULES),
      'SELECT COUNT(id) FROM Leads where id is not null',
    );
  });

  it('normalizes IS NOT NULL and <> operators', () => {
    assert.equal(
      normalizeCoqlQuery('SELECT COUNT(id) FROM Leads WHERE Email IS NOT NULL', MODULES),
      'SELECT COUNT(id) FROM Leads WHERE Email is not null',
    );
    assert.equal(
      normalizeCoqlQuery('SELECT COUNT(id) FROM Leads WHERE Email <> null', MODULES),
      'SELECT COUNT(id) FROM Leads WHERE Email != null',
    );
  });

  it('fixes module casing in FROM clause', () => {
    assert.equal(
      normalizeCoqlQuery('SELECT COUNT(id) FROM leads', MODULES),
      'SELECT COUNT(id) FROM Leads where id is not null',
    );
  });

  it('leaves valid queries unchanged', () => {
    const q = 'SELECT COUNT(id) FROM Leads WHERE Email is not null';
    assert.equal(normalizeCoqlQuery(q, MODULES), q);
  });
});

describe('isZohoRecordId', () => {
  it('accepts long numeric Zoho ids only', () => {
    assert.equal(isZohoRecordId('1384269000000531230'), true);
    assert.equal(isZohoRecordId('Michael Ruta'), false);
    assert.equal(isZohoRecordId('9'), false);
    assert.equal(isZohoRecordId('10th'), false);
  });
});

describe('extractZohoArray', () => {
  it('reads data, modules, and fields arrays', () => {
    assert.deepEqual(extractZohoArray({ data: [{ id: '1' }] }), [{ id: '1' }]);
    assert.deepEqual(extractZohoArray({ modules: [{ api_name: 'Leads' }] }), [{ api_name: 'Leads' }]);
    assert.deepEqual(extractZohoArray({ fields: [{ api_name: 'Email' }] }), [{ api_name: 'Email' }]);
    assert.deepEqual(extractZohoArray({ info: {} }), []);
  });
});
