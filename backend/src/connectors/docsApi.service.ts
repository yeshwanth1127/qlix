/**
 * Google Docs API v1 client. Pure functions — scope/JIT/audit live in docsTool.service.
 */
import { googleApiFetch, GoogleApiError } from './googleApiFetch.js';

export { GoogleApiError as DocsApiError };

const DOCS_API = 'https://docs.googleapis.com/v1';

function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  if (typeof n.textRun === 'object' && n.textRun) {
    const tr = n.textRun as { content?: string };
    return tr.content ?? '';
  }
  let out = '';
  for (const key of ['paragraph', 'table', 'tableRow', 'tableCell', 'sectionBreak']) {
    if (n[key] && typeof n[key] === 'object') out += extractText(n[key]);
  }
  if (Array.isArray(n.elements)) {
    for (const el of n.elements) out += extractText(el);
  }
  if (Array.isArray(n.paragraphs)) {
    for (const p of n.paragraphs) out += extractText(p);
  }
  if (Array.isArray(n.content)) {
    for (const c of n.content) out += extractText(c);
  }
  return out;
}

export async function docsGetDocument(params: {
  accessToken: string;
  documentId: string;
}): Promise<{ documentId: string; title: string; text: string; revisionId: string }> {
  const body = await googleApiFetch(
    params.accessToken,
    `${DOCS_API}/documents/${encodeURIComponent(params.documentId)}`,
  );
  const bodyContent = body.body as { content?: unknown[] } | undefined;
  const text = bodyContent?.content
    ? bodyContent.content.map((c) => extractText(c)).join('')
    : '';
  return {
    documentId: String(body.documentId ?? params.documentId),
    title: String(body.title ?? ''),
    text,
    revisionId: String(body.revisionId ?? ''),
  };
}

export async function docsCreateDocument(params: {
  accessToken: string;
  title: string;
  initialText?: string;
}): Promise<{ documentId: string; title: string }> {
  const created = await googleApiFetch(params.accessToken, `${DOCS_API}/documents`, {
    method: 'POST',
    body: JSON.stringify({ title: params.title }),
  });
  const documentId = String(created.documentId ?? '');
  if (!documentId) throw new GoogleApiError('Docs create returned no documentId');
  const initial = params.initialText?.trim();
  if (initial) {
    await docsAppendText({ accessToken: params.accessToken, documentId, text: initial });
  }
  return { documentId, title: String(created.title ?? params.title) };
}

export async function docsAppendText(params: {
  accessToken: string;
  documentId: string;
  text: string;
}): Promise<{ documentId: string; ok: true }> {
  const endIndex = await docsEndIndex(params.accessToken, params.documentId);
  // Insert before the final newline of the doc body.
  const insertAt = Math.max(1, endIndex - 1);
  const text = params.text.endsWith('\n') ? params.text : `${params.text}\n`;
  await googleApiFetch(
    params.accessToken,
    `${DOCS_API}/documents/${encodeURIComponent(params.documentId)}:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: insertAt }, text } }],
      }),
    },
  );
  return { documentId: params.documentId, ok: true };
}

export async function docsReplaceAllText(params: {
  accessToken: string;
  documentId: string;
  findText: string;
  replaceText: string;
  matchCase?: boolean;
}): Promise<{ documentId: string; occurrencesChanged: number }> {
  const body = await googleApiFetch(
    params.accessToken,
    `${DOCS_API}/documents/${encodeURIComponent(params.documentId)}:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            replaceAllText: {
              containsText: {
                text: params.findText,
                matchCase: Boolean(params.matchCase),
              },
              replaceText: params.replaceText,
            },
          },
        ],
      }),
    },
  );
  const replies = Array.isArray(body.replies) ? body.replies : [];
  const first = replies[0] as { replaceAllText?: { occurrencesChanged?: number } } | undefined;
  return {
    documentId: params.documentId,
    occurrencesChanged: Number(first?.replaceAllText?.occurrencesChanged ?? 0),
  };
}

async function docsEndIndex(accessToken: string, documentId: string): Promise<number> {
  const body = await googleApiFetch(
    accessToken,
    `${DOCS_API}/documents/${encodeURIComponent(documentId)}?fields=body(content(endIndex))`,
  );
  const content = (body.body as { content?: Array<{ endIndex?: number }> } | undefined)?.content;
  if (!content?.length) return 1;
  const last = content[content.length - 1];
  return Number(last?.endIndex ?? 1);
}
