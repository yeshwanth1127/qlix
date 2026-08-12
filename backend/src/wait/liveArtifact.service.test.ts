import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildWhatsAppReplyRow,
  isDuplicateRow,
  materializeArtifactBytes,
  upsertLiveArtifactList,
} from './liveArtifact.service.js';
import type { LiveArtifactState } from './waitPolicy.types.js';

describe('materializeArtifactBytes', () => {
  it('writes xlsx bytes with header row', async () => {
    const { bytes, contentType } = await materializeArtifactBytes(
      'xlsx',
      ['Name', 'Phone'],
      [{ Name: 'Ada', Phone: '123' }],
    );
    assert.ok(bytes.length > 0);
    assert.match(contentType, /spreadsheet/);
  });
});

describe('buildWhatsAppReplyRow', () => {
  it('maps inbound fields to configured columns', () => {
    const row = buildWhatsAppReplyRow({
      columns: ['Name', 'Phone', 'Reply', 'Interest', 'Replied at'],
      jid: '918000000000@s.whatsapp.net',
      text: 'yes interested',
      pushName: 'Ada',
      interest: 'interested',
      contactHint: { name: 'Ada Lovelace', phone: '918000000000' },
    });
    assert.equal(row.Name, 'Ada Lovelace');
    assert.equal(row.Phone, '+91 80000 00000');
    assert.equal(row.Interest, 'interested');
    assert.equal(row._jid, '918000000000@s.whatsapp.net');
  });
});

describe('isDuplicateRow', () => {
  const artifact: LiveArtifactState = {
    id: 'live_artifact_live_reply_sheet',
    sideEffectId: 'live_reply_sheet',
    sandboxId: 'abc',
    url: 'https://example.com/sandbox/abc',
    fileName: 'sheet.xlsx',
    format: 'xlsx',
    columns: ['Phone'],
    rows: [{ _jid: '918000000000@s.whatsapp.net', Phone: '+91 80000 00000' }],
    rowCount: 1,
    updatedAt: new Date().toISOString(),
  };

  it('dedupes by contact jid', () => {
    assert.equal(
      isDuplicateRow(artifact, { _jid: '918000000000@s.whatsapp.net', Phone: '+91 80000 00000' }, 'contact_jid'),
      true,
    );
    assert.equal(
      isDuplicateRow(artifact, { _jid: '919999999999@s.whatsapp.net', Phone: '+91 99999 99999' }, 'contact_jid'),
      false,
    );
  });
});

describe('upsertLiveArtifactList', () => {
  it('replaces an artifact with the same id', () => {
    const base: LiveArtifactState = {
      id: 'live_artifact_live_reply_sheet',
      sideEffectId: 'live_reply_sheet',
      sandboxId: 'abc',
      url: 'https://example.com/sandbox/abc',
      fileName: 'sheet.xlsx',
      format: 'xlsx',
      columns: [],
      rows: [],
      rowCount: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const updated = { ...base, rowCount: 2, updatedAt: '2026-01-02T00:00:00.000Z' };
    const list = upsertLiveArtifactList([base], updated);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.rowCount, 2);
  });
});
