import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalFieldName,
  recipientAddressesEqual,
  resolveCanonicalRecipients,
} from './recipientResolution.js';

test('normalizes field names independently of spaces, punctuation, and case', () => {
  assert.equal(canonicalFieldName('WhatsApp_Number'), 'whatsappnumber');
  assert.equal(canonicalFieldName('PHONE NO.'), 'phoneno');
});

test('resolves channel-neutral recipients from nested arbitrary records', () => {
  const [recipient] = resolveCanonicalRecipients({
    value: { findings: [{ 'Contact Name': 'Karthik', 'Phone Number': '+91 99805 47804' }] },
    channel: 'whatsapp',
    sourceRefs: ['team-input:sheet'],
    rowRefs: ['team-input:sheet:row:3'],
  });
  assert.equal(recipient?.displayName, 'Karthik');
  assert.equal(recipient?.address, '919980547804');
  assert.equal(recipient?.sourceRef, 'team-input:sheet');
  assert.match(recipient?.recipientId ?? '', /^recipient_[a-f0-9]{24}$/);
});

test('supports email through the same resolver and rejects invalid addresses', () => {
  const recipients = resolveCanonicalRecipients({
    value: [
      { Name: 'A', 'Email Address': 'A@example.com' },
      { Name: 'B', Email: 'not-an-email' },
    ],
    channel: 'email',
    sourceRefs: ['team-input:contacts'],
    rowRefs: ['team-input:contacts:row:2', 'team-input:contacts:row:3'],
  });
  assert.deepEqual(recipients.map((row) => row.address), ['a@example.com']);
  assert.equal(recipientAddressesEqual('email', 'A@EXAMPLE.COM', 'a@example.com'), true);
});
