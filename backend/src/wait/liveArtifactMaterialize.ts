import { Buffer } from 'node:buffer';
import PDFDocument from 'pdfkit';
import type { LiveArtifactFormat, LiveArtifactRow } from './waitPolicy.types.js';

function rowsToAoA(columns: string[], rows: LiveArtifactRow[]): unknown[][] {
  const visibleColumns = columns.filter((column) => !column.startsWith('_'));
  return [
    visibleColumns,
    ...rows.map((row) => visibleColumns.map((col) => row[col] ?? '')),
  ];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function materializeMarkdown(columns: string[], rows: LiveArtifactRow[], title: string): Buffer {
  const visibleColumns = columns.filter((column) => !column.startsWith('_'));
  const lines = [`# ${title}`, ''];
  if (visibleColumns.length === 0) {
    lines.push('_Waiting for replies…_');
    return Buffer.from(lines.join('\n'), 'utf8');
  }
  lines.push(`| ${visibleColumns.join(' | ')} |`);
  lines.push(`| ${visibleColumns.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${visibleColumns.map((col) => String(row[col] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`);
  }
  if (rows.length === 0) {
    lines.push(`| ${visibleColumns.map(() => '—').join(' | ')} |`);
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

function materializeHtml(columns: string[], rows: LiveArtifactRow[], title: string): Buffer {
  const visibleColumns = columns.filter((column) => !column.startsWith('_'));
  const bodyRows =
    rows.length > 0
      ? rows
          .map(
            (row) =>
              `<tr>${visibleColumns
                .map((col) => `<td>${escapeHtml(String(row[col] ?? '—'))}</td>`)
                .join('')}</tr>`,
          )
          .join('')
      : `<tr><td colspan="${Math.max(visibleColumns.length, 1)}">Waiting for replies…</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #111827; }
    h1 { font-size: 1.25rem; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
    th { background: #2563eb; color: #fff; }
    tr:nth-child(even) td { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table>
    <thead><tr>${visibleColumns.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
  return Buffer.from(html, 'utf8');
}

async function materializePdf(
  columns: string[],
  rows: LiveArtifactRow[],
  title: string,
): Promise<Buffer> {
  const visibleColumns = columns.filter((column) => !column.startsWith('_'));
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#2563eb').text(title, { underline: false });
    doc.moveDown(0.75);
    doc.fontSize(10).fillColor('#111827');

    if (visibleColumns.length === 0) {
      doc.text('Waiting for replies…');
      doc.end();
      return;
    }

    for (const row of rows) {
      for (const col of visibleColumns) {
        doc.font('Helvetica-Bold').text(`${col}: `, { continued: true });
        doc.font('Helvetica').text(String(row[col] ?? '—'));
      }
      doc.moveDown(0.5);
      doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#e5e7eb').stroke();
      doc.moveDown(0.5);
    }

    if (rows.length === 0) {
      doc.text('No replies yet.');
    }

    doc.end();
  });
}

async function materializePptx(
  columns: string[],
  rows: LiveArtifactRow[],
  title: string,
): Promise<Buffer> {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  // pptxgenjs CJS default export is the constructor at runtime.
  const PptxGenJS = require('pptxgenjs') as new () => {
    layout: string;
    addSlide(): {
      addText: (text: string, opts: Record<string, unknown>) => void;
      addTable: (rows: unknown[], opts: Record<string, unknown>) => void;
    };
    write: (opts: { outputType: 'nodebuffer' }) => Promise<Buffer | ArrayBuffer | Uint8Array>;
  };
  const visibleColumns = columns.filter((column) => !column.startsWith('_'));
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const slide = pptx.addSlide();
  slide.addText(title, {
    x: 0.5,
    y: 0.35,
    w: 9,
    h: 0.6,
    fontSize: 20,
    bold: true,
    color: '2563EB',
  });

  if (visibleColumns.length === 0) {
    slide.addText('Waiting for replies…', { x: 0.5, y: 1.2, w: 9, fontSize: 14, color: '6B7280' });
  } else {
    const header = visibleColumns.map((col) => ({
      text: col,
      options: { bold: true, color: 'FFFFFF', fill: { color: '2563EB' } },
    }));
    const body =
      rows.length > 0
        ? rows.map((row) => visibleColumns.map((col) => String(row[col] ?? '—')))
        : [visibleColumns.map(() => '—')];
    slide.addTable([header, ...body], {
      x: 0.4,
      y: 1.1,
      w: 9.2,
      colW: visibleColumns.map(() => 9.2 / visibleColumns.length),
      fontSize: 11,
      border: { type: 'solid', color: 'E5E7EB', pt: 0.5 },
    });
  }

  const output = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}

export async function materializeLiveArtifactBytes(
  format: LiveArtifactFormat,
  columns: string[],
  rows: LiveArtifactRow[],
  title = 'Live artifact',
): Promise<{ bytes: Buffer; contentType: string }> {
  if (format === 'json') {
    const visibleColumns = columns.filter((column) => !column.startsWith('_'));
    const objects = rows.map((row) => {
      const obj: Record<string, string | null> = {};
      for (const col of visibleColumns) obj[col] = row[col] ?? null;
      return obj;
    });
    return {
      bytes: Buffer.from(JSON.stringify(objects, null, 2), 'utf8'),
      contentType: 'application/json',
    };
  }

  if (format === 'csv') {
    const table = rowsToAoA(columns, rows);
    const lines = table.map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? '');
          if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
          return text;
        })
        .join(','),
    );
    return { bytes: Buffer.from(lines.join('\n'), 'utf8'), contentType: 'text/csv' };
  }

  if (format === 'md') {
    return {
      bytes: materializeMarkdown(columns, rows, title),
      contentType: 'text/markdown; charset=utf-8',
    };
  }

  if (format === 'html') {
    return {
      bytes: materializeHtml(columns, rows, title),
      contentType: 'text/html; charset=utf-8',
    };
  }

  if (format === 'pdf') {
    return {
      bytes: await materializePdf(columns, rows, title),
      contentType: 'application/pdf',
    };
  }

  if (format === 'pptx') {
    return {
      bytes: await materializePptx(columns, rows, title),
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
  }

  const XLSX = await import('xlsx');
  const table = rowsToAoA(columns, rows);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(table);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    bytes,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
