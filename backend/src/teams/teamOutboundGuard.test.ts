import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTeamOutboundAllowed,
  TeamOutboundProvenanceError,
} from './teamOutboundGuard.js';
import type { TeamMailboxMessageDTO, TeamRunDTO } from './teams.types.js';

const run = {
  inputs: [
    {
      id: 'sheet',
      ref: 'team-input:sheet',
      purpose: 'authoritative_input',
    },
    {
      id: 'brochure',
      ref: 'team-input:brochure',
      purpose: 'reference_asset',
    },
  ],
} as TeamRunDTO;

const mailbox = [
  {
    status: 'completed',
    payload: {
      data: {
        findings: {
          leads: [{ name: 'Aarav', phone: '+919111111111', city: 'Bangalore' }],
        },
      },
      provenance: {
        inputRefs: ['team-input:sheet'],
        recordRefs: ['team-input:sheet:row:2'],
        knowledgeRefs: [],
      },
    },
  },
] as TeamMailboxMessageDTO[];

test('outbound guard matches capitalized Phone fields and country-code prefixes', () => {
  const capitalized = [
    {
      status: 'completed',
      payload: {
        data: {
          findings: {
            leads: [{ Name: 'Aarav Sharma', Phone: '+918095404788', City: 'Bangalore' }],
          },
        },
        provenance: {
          inputRefs: ['team-input:sheet'],
          recordRefs: ['team-input:sheet:row:2'],
        },
      },
    },
  ] as TeamMailboxMessageDTO[];
  assert.doesNotThrow(() =>
    assertTeamOutboundAllowed(run, capitalized, {
      recipient: '+918095404788',
      phone: '+918095404788',
      jid: '918095404788@s.whatsapp.net',
      name: 'Aarav Sharma',
    }),
  );
});

test('outbound guard canonicalizes common spreadsheet phone aliases', () => {
  for (const field of ['Phone Number', 'Mobile No', 'WhatsApp Number', 'Contact Number']) {
    const aliased = [
      {
        status: 'completed',
        payload: {
          data: { findings: [{ Name: 'Karthik Rao', [field]: '+919980547804' }] },
          provenance: {
            inputRefs: ['team-input:sheet'],
            recordRefs: ['team-input:sheet:row:3'],
          },
        },
      },
    ] as TeamMailboxMessageDTO[];
    assert.doesNotThrow(() =>
      assertTeamOutboundAllowed(run, aliased, {
        recipient: '+919980547804',
        phone: '+919980547804',
        jid: '919980547804@s.whatsapp.net',
        name: 'Karthik Rao',
      }),
      field,
    );
  }
});

test('outbound guard permits a validated authoritative contact', () => {
  assert.doesNotThrow(() =>
    assertTeamOutboundAllowed(run, mailbox, {
      recipient: 'Aarav',
      name: 'Aarav',
      phone: '+919111111111',
      jid: '919111111111@s.whatsapp.net',
    }),
  );
});

test('outbound guard trusts a validated phone and ignores a device-local contact nickname', () => {
  const match = assertTeamOutboundAllowed(run, mailbox, {
    recipient: '+919111111111',
    phone: '+919111111111',
    jid: '919111111111@s.whatsapp.net',
    name: 'My local nickname',
  });
  assert.deepEqual(match, { phone: '919111111111', name: 'Aarav' });
});

test('outbound guard blocks brochure, stale-memory, and name-remapped targets', () => {
  for (const target of [
    { recipient: 'Brochure', phone: '9442592170', jid: null, name: 'Brochure' },
    { recipient: 'Bhuveneshwari', phone: '919888888888', jid: null, name: 'Bhuveneshwari' },
    { recipient: 'Swetha', phone: '+919111111111', jid: null, name: 'Swetha' },
  ]) {
    assert.throws(
      () => assertTeamOutboundAllowed(run, mailbox, target),
      TeamOutboundProvenanceError,
    );
  }
});
