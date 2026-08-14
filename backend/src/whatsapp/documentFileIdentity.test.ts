import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWhatsAppDocumentIdentity,
  sniffDocumentExtension,
} from './documentFileIdentity.js';

describe('resolveWhatsAppDocumentIdentity', () => {
  it('appends sniffed .xlsx when the display name has no extension', () => {
    // Minimal ZIP that contains the xl/ marker WhatsApp/Office sniff looks for.
    const bytes = Buffer.from('PK\x03\x04........xl/workbook.xml........');
    const id = resolveWhatsAppDocumentIdentity({
      fileName: 'WhatsApp Responders',
      bytes,
    });
    assert.equal(id.ext, '.xlsx');
    assert.match(id.fileName, /\.xlsx$/i);
    assert.match(id.mimetype, /spreadsheetml\.sheet/);
  });

  it('keeps an existing extension', () => {
    const id = resolveWhatsAppDocumentIdentity({
      fileName: 'report.xlsx',
      bytes: Buffer.from('not-a-real-file'),
    });
    assert.equal(id.fileName, 'report.xlsx');
    assert.equal(id.ext, '.xlsx');
  });

  it('inherits extension from fallback path name', () => {
    const id = resolveWhatsAppDocumentIdentity({
      fileName: 'Responders',
      fallbackName: '/tmp/whatsapp-responders.xlsx',
    });
    assert.equal(id.ext, '.xlsx');
    assert.match(id.fileName, /\.xlsx$/i);
  });
});

describe('sniffDocumentExtension', () => {
  it('detects PDF magic', () => {
    assert.equal(sniffDocumentExtension(Buffer.from('%PDF-1.4....')), '.pdf');
  });
});
