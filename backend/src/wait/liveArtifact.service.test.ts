import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyContactRowToArtifact,
  buildReplyRow,
  buildWhatsAppReplyRow,
  isDuplicateRow,
  materializeArtifactBytes,
  mergeReplyRow,
  rowContactJid,
  upsertLiveArtifactList,
} from './liveArtifact.service.js';
import { customLiveSheetColumns } from './liveSheetColumns.js';
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

describe('goal-specific columns', () => {
  const columns = ['Lead name', 'Mobile', 'Response', 'Interest', 'Replied at', 'City', 'Degree', 'Experience'];

  it('treats only the non-contact columns as extraction targets', () => {
    assert.deepEqual(customLiveSheetColumns(columns), ['City', 'Degree', 'Experience']);
  });

  it('ignores hidden columns', () => {
    assert.deepEqual(customLiveSheetColumns(['_jid', 'Response', 'City']), ['City']);
  });

  it('fills extracted values and leaves unanswered ones blank', () => {
    const row = buildReplyRow({
      columns,
      jid: '918000000000@s.whatsapp.net',
      text: 'yes, I am in Bangalore',
      interest: 'interested',
      extracted: { City: 'Bangalore' },
    });
    assert.equal(row.City, 'Bangalore');
    assert.equal(row.Degree, null);
    assert.equal(row.Experience, null);
    assert.equal(row.Response, 'yes, I am in Bangalore');
  });
});

describe('mergeReplyRow', () => {
  const columns = ['Name', 'Phone', 'Reply', 'Interest', 'Replied at', 'City', 'Degree'];

  const first = {
    _jid: '918000000000@s.whatsapp.net',
    Name: 'Ada',
    Phone: '+91 80000 00000',
    Reply: 'yes',
    Interest: 'interested',
    'Replied at': '2026-08-15T10:00:00.000Z',
    City: null,
    Degree: null,
  };

  it('tops up blank details from a follow-up message', () => {
    const merged = mergeReplyRow(
      first,
      {
        _jid: first._jid,
        Name: null,
        Phone: '+91 80000 00000',
        Reply: 'Bangalore, B.Tech',
        Interest: 'unclear',
        'Replied at': '2026-08-15T10:05:00.000Z',
        City: 'Bangalore',
        Degree: 'B.Tech',
      },
      columns,
    );
    assert.equal(merged.City, 'Bangalore');
    assert.equal(merged.Degree, 'B.Tech');
    assert.equal(merged.Name, 'Ada', 'keeps the name it already had');
    assert.equal(merged['Replied at'], '2026-08-15T10:05:00.000Z', 'takes the latest timestamp');
  });

  it('keeps the conversation trail in the reply cell', () => {
    const merged = mergeReplyRow(
      first,
      { ...first, Reply: 'Bangalore', City: 'Bangalore' },
      columns,
    );
    assert.equal(merged.Reply, 'yes | Bangalore');
  });

  it('does not downgrade a decisive interest label to unclear', () => {
    const merged = mergeReplyRow(first, { ...first, Reply: 'Bangalore', Interest: 'unclear' }, columns);
    assert.equal(merged.Interest, 'interested');
  });

  it('does still accept a decisive label over a prior unclear one', () => {
    const merged = mergeReplyRow(
      { ...first, Interest: 'unclear' },
      { ...first, Reply: 'yes please', Interest: 'interested' },
      columns,
    );
    assert.equal(merged.Interest, 'interested');
  });

  it('does not duplicate a repeated message', () => {
    const merged = mergeReplyRow(first, { ...first }, columns);
    assert.equal(merged.Reply, 'yes');
  });

  it('never blanks a detail already captured', () => {
    const withCity = { ...first, City: 'Bangalore' };
    const merged = mergeReplyRow(withCity, { ...first, Reply: 'ok', City: null }, columns);
    assert.equal(merged.City, 'Bangalore');
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

describe('applyContactRowToArtifact', () => {
  const baseArtifact: LiveArtifactState = {
    id: 'live_artifact_live_reply_sheet',
    sideEffectId: 'live_reply_sheet',
    sandboxId: 'abc',
    url: 'https://example.com/sandbox/abc',
    fileName: 'sheet.xlsx',
    format: 'xlsx',
    columns: ['Lead name', 'Mobile', 'Response', 'Interest', 'Replied at'],
    rows: [
      {
        _jid: '918000000001@s.whatsapp.net',
        'Lead name': 'Ada',
        Mobile: '+91 80000 00001',
        Response: 'yes',
        Interest: 'interested',
        'Replied at': '2026-08-17T10:00:00.000Z',
      },
    ],
    rowCount: 1,
    updatedAt: '2026-08-17T10:00:00.000Z',
  };

  it('appends a new contact without touching existing rows', () => {
    const row = buildReplyRow({
      columns: baseArtifact.columns,
      jid: '918000000002@s.whatsapp.net',
      text: 'yes',
      interest: 'interested',
    });
    const { artifact, changed } = applyContactRowToArtifact(baseArtifact, row, 'contact_jid');
    assert.equal(changed, true);
    assert.equal(artifact.rowCount, 2);
    assert.equal(artifact.rows[0]!.Response, 'yes');
    assert.equal(artifact.rows[1]!.Response, 'yes');
  });

  it('merges follow-ups for the same contact in place', () => {
    const row = buildReplyRow({
      columns: baseArtifact.columns,
      jid: '918000000001@s.whatsapp.net',
      text: 'Bangalore',
      interest: 'unclear',
    });
    const { artifact, changed } = applyContactRowToArtifact(baseArtifact, row, 'contact_jid');
    assert.equal(changed, true);
    assert.equal(artifact.rowCount, 1);
    assert.equal(artifact.rows[0]!.Response, 'yes | Bangalore');
    assert.equal(artifact.rows[0]!.Interest, 'interested');
  });

  it('simulates two parallel writers landing on the same artifact state', () => {
    let state = baseArtifact;
    const hemila = buildReplyRow({
      columns: state.columns,
      jid: '918000000002@s.whatsapp.net',
      text: 'yes',
      interest: 'interested',
    });
    const raghu = buildReplyRow({
      columns: state.columns,
      jid: '918000000003@s.whatsapp.net',
      text: 'yes',
      interest: 'interested',
    });

    const first = applyContactRowToArtifact(state, hemila, 'contact_jid');
    state = first.artifact;
    const second = applyContactRowToArtifact(state, raghu, 'contact_jid');
    state = second.artifact;

    assert.equal(state.rowCount, 3);
    assert.deepEqual(
      state.rows.map((row) => rowContactJid(row)),
      [
        '918000000001@s.whatsapp.net',
        '918000000002@s.whatsapp.net',
        '918000000003@s.whatsapp.net',
      ],
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
