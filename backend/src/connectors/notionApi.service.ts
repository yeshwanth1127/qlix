/**
 * Notion REST API client. Pure functions — scope/JIT/audit live in notionTool.service.
 * @see https://developers.notion.com/reference/intro
 */

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export class NotionApiError extends Error {
  readonly code = 'notion_api_failed';
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export type NotionBlock = Record<string, unknown>;

async function notionFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_VERSION,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text();
  if (resp.status === 204 || !text) {
    if (!resp.ok) throw new NotionApiError(`Notion API ${resp.status}`, resp.status);
    return {};
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text.slice(0, 4000) };
  }
  if (!resp.ok) {
    const message =
      typeof body.message === 'string'
        ? body.message
        : typeof body.code === 'string'
          ? `${body.code}: ${text.slice(0, 300)}`
          : text.slice(0, 300);
    throw new NotionApiError(`Notion API ${resp.status}: ${message}`, resp.status);
  }
  return body;
}

function extractRichText(blockData: Record<string, unknown>): string {
  const richText = Array.isArray(blockData.rich_text) ? blockData.rich_text : [];
  return richText
    .map((entry) =>
      entry && typeof entry === 'object' && typeof (entry as { plain_text?: unknown }).plain_text === 'string'
        ? (entry as { plain_text: string }).plain_text
        : '',
    )
    .join('');
}

export function extractPageTitle(page: Record<string, unknown>): string {
  const properties = page.properties;
  if (!properties || typeof properties !== 'object') return '(Untitled)';
  for (const value of Object.values(properties as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const prop = value as Record<string, unknown>;
    const titleItems = Array.isArray(prop.title) ? prop.title : [];
    if (titleItems.length > 0) {
      return titleItems
        .map((item) =>
          item && typeof item === 'object' && typeof (item as { plain_text?: unknown }).plain_text === 'string'
            ? (item as { plain_text: string }).plain_text
            : '',
        )
        .join('');
    }
  }
  return '(Untitled)';
}

export function renderBlocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const blockType = typeof block.type === 'string' ? block.type : '';
    const blockData =
      blockType && block[blockType] && typeof block[blockType] === 'object'
        ? (block[blockType] as Record<string, unknown>)
        : {};
    const text = extractRichText(blockData);

    switch (blockType) {
      case 'paragraph':
        lines.push(text);
        break;
      case 'heading_1':
        lines.push(`# ${text}`);
        break;
      case 'heading_2':
        lines.push(`## ${text}`);
        break;
      case 'heading_3':
        lines.push(`### ${text}`);
        break;
      case 'bulleted_list_item':
        lines.push(`- ${text}`);
        break;
      case 'numbered_list_item':
        lines.push(`1. ${text}`);
        break;
      case 'to_do': {
        const checked = Boolean(blockData.checked);
        lines.push(`- [${checked ? 'x' : ' '}] ${text}`);
        break;
      }
      case 'code': {
        const language = typeof blockData.language === 'string' ? blockData.language : '';
        lines.push(`\`\`\`${language}`, text, '```');
        break;
      }
      case 'quote':
        lines.push(`> ${text}`);
        break;
      case 'divider':
        lines.push('---');
        break;
      default:
        if (text) lines.push(text);
        break;
    }
  }
  return lines.join('\n');
}

function richText(content: string): Array<{ type: 'text'; text: { content: string } }> {
  // Notion rich_text content max is 2000 chars per item.
  const chunks: Array<{ type: 'text'; text: { content: string } }> = [];
  const trimmed = content.slice(0, 8000);
  for (let i = 0; i < trimmed.length; i += 2000) {
    chunks.push({ type: 'text', text: { content: trimmed.slice(i, i + 2000) } });
  }
  if (chunks.length === 0) chunks.push({ type: 'text', text: { content: '' } });
  return chunks;
}

/** Convert markdown / plain text into a limited set of Notion paragraph-like blocks. */
export function markdownToBlocks(markdown: string): NotionBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: NotionBlock[] = [];
  let i = 0;

  while (i < lines.length && blocks.length < 100) {
    const line = lines[i] ?? '';

    if (line.trim() === '---') {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim() || 'plain text';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length && (lines[i] ?? '').startsWith('```')) i += 1;
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: richText(codeLines.join('\n')),
          language: language.slice(0, 80),
        },
      });
      continue;
    }

    const heading1 = /^#\s+(.+)$/.exec(line);
    if (heading1) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: richText(heading1[1]!) },
      });
      i += 1;
      continue;
    }
    const heading2 = /^##\s+(.+)$/.exec(line);
    if (heading2) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: richText(heading2[1]!) },
      });
      i += 1;
      continue;
    }
    const heading3 = /^###\s+(.+)$/.exec(line);
    if (heading3) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: richText(heading3[1]!) },
      });
      i += 1;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: richText(quote[1] ?? '') },
      });
      i += 1;
      continue;
    }

    const todo = /^-\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (todo) {
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: richText(todo[2] ?? ''),
          checked: todo[1]!.toLowerCase() === 'x',
        },
      });
      i += 1;
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: richText(bullet[1] ?? '') },
      });
      i += 1;
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: richText(numbered[1] ?? '') },
      });
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: richText(line) },
    });
    i += 1;
  }

  if (blocks.length === 0) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: richText('') },
    });
  }
  return blocks;
}

export function coerceNotionProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      // Already Notion-shaped property value.
      out[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      out[key] = { checkbox: value };
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = { number: value };
      continue;
    }
    const text = String(value);
    // Heuristic: first string prop named Title/Name/title uses title type when caller passes flat map;
    // for generic keys default to rich_text — callers creating DB rows should pass Notion-shaped props
    // for title columns. Prefer title for common names.
    if (/^(title|name)$/i.test(key)) {
      out[key] = { title: richText(text) };
    } else {
      out[key] = { rich_text: richText(text) };
    }
  }
  return out;
}

export async function notionSearch(params: {
  accessToken: string;
  query?: string;
  filter?: 'page' | 'database';
  pageSize?: number;
  startCursor?: string | null;
}): Promise<{
  results: Array<{
    id: string;
    object: string;
    title: string;
    url: string;
    lastEditedTime: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const body: Record<string, unknown> = {
    page_size: Math.min(100, Math.max(1, params.pageSize ?? 20)),
  };
  if (params.query?.trim()) body.query = params.query.trim();
  if (params.filter) {
    body.filter = { property: 'object', value: params.filter };
  }
  if (params.startCursor) body.start_cursor = params.startCursor;

  const resp = await notionFetch(params.accessToken, '/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const raw = Array.isArray(resp.results) ? (resp.results as Record<string, unknown>[]) : [];
  const results = raw.map((item) => {
    const object = typeof item.object === 'string' ? item.object : '';
    let title = '(Untitled)';
    if (object === 'page') {
      title = extractPageTitle(item);
    } else if (object === 'database') {
      const titleArr = Array.isArray(item.title) ? item.title : [];
      title =
        titleArr
          .map((t) =>
            t && typeof t === 'object' && typeof (t as { plain_text?: unknown }).plain_text === 'string'
              ? (t as { plain_text: string }).plain_text
              : '',
          )
          .join('') || '(Untitled)';
    }
    return {
      id: String(item.id ?? ''),
      object,
      title,
      url: typeof item.url === 'string' ? item.url : '',
      lastEditedTime: typeof item.last_edited_time === 'string' ? item.last_edited_time : '',
    };
  });

  return {
    results,
    nextCursor: typeof resp.next_cursor === 'string' ? resp.next_cursor : null,
    hasMore: Boolean(resp.has_more),
  };
}

export async function notionGetPage(params: {
  accessToken: string;
  pageId: string;
}): Promise<{
  id: string;
  title: string;
  url: string;
  lastEditedTime: string;
  properties: Record<string, unknown>;
  contentMarkdown: string;
}> {
  const pageId = params.pageId.trim();
  const page = await notionFetch(params.accessToken, `/pages/${encodeURIComponent(pageId)}`);
  const blocksResp = await notionFetch(
    params.accessToken,
    `/blocks/${encodeURIComponent(pageId)}/children?page_size=100`,
  );
  const blocks = Array.isArray(blocksResp.results)
    ? (blocksResp.results as NotionBlock[])
    : [];

  return {
    id: String(page.id ?? pageId),
    title: extractPageTitle(page),
    url: typeof page.url === 'string' ? page.url : '',
    lastEditedTime: typeof page.last_edited_time === 'string' ? page.last_edited_time : '',
    properties:
      page.properties && typeof page.properties === 'object'
        ? (page.properties as Record<string, unknown>)
        : {},
    contentMarkdown: renderBlocksToMarkdown(blocks),
  };
}

export async function notionQueryDatabase(params: {
  accessToken: string;
  databaseId: string;
  pageSize?: number;
  startCursor?: string | null;
  filter?: Record<string, unknown> | null;
  sorts?: unknown[] | null;
}): Promise<{
  results: Array<{
    id: string;
    title: string;
    url: string;
    lastEditedTime: string;
    properties: Record<string, unknown>;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const body: Record<string, unknown> = {
    page_size: Math.min(100, Math.max(1, params.pageSize ?? 20)),
  };
  if (params.startCursor) body.start_cursor = params.startCursor;
  if (params.filter) body.filter = params.filter;
  if (params.sorts) body.sorts = params.sorts;

  const resp = await notionFetch(
    params.accessToken,
    `/databases/${encodeURIComponent(params.databaseId.trim())}/query`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  const raw = Array.isArray(resp.results) ? (resp.results as Record<string, unknown>[]) : [];
  return {
    results: raw.map((page) => ({
      id: String(page.id ?? ''),
      title: extractPageTitle(page),
      url: typeof page.url === 'string' ? page.url : '',
      lastEditedTime: typeof page.last_edited_time === 'string' ? page.last_edited_time : '',
      properties:
        page.properties && typeof page.properties === 'object'
          ? (page.properties as Record<string, unknown>)
          : {},
    })),
    nextCursor: typeof resp.next_cursor === 'string' ? resp.next_cursor : null,
    hasMore: Boolean(resp.has_more),
  };
}

export async function notionCreatePage(params: {
  accessToken: string;
  parentPageId?: string;
  parentDatabaseId?: string;
  title: string;
  contentMarkdown?: string;
  properties?: Record<string, unknown>;
}): Promise<{ id: string; url: string; title: string }> {
  const parentPageId = params.parentPageId?.trim();
  const parentDatabaseId = params.parentDatabaseId?.trim();
  if (!parentPageId && !parentDatabaseId) {
    throw new NotionApiError('parentPageId or parentDatabaseId is required', 400);
  }

  let properties: Record<string, unknown> = {};
  if (params.properties && Object.keys(params.properties).length > 0) {
    properties = coerceNotionProperties(params.properties);
  }
  if (parentPageId) {
    // Child page under a page always uses the Title property.
    properties = {
      ...properties,
      title: { title: richText(params.title.trim() || 'Untitled') },
    };
  } else if (!Object.values(properties).some((p) => p && typeof p === 'object' && 'title' in (p as object))) {
    // Database rows need a title property — common default name is "Name".
    properties = {
      Name: { title: richText(params.title.trim() || 'Untitled') },
      ...properties,
    };
  }

  const children = params.contentMarkdown?.trim()
    ? markdownToBlocks(params.contentMarkdown)
    : undefined;

  const body: Record<string, unknown> = {
    parent: parentDatabaseId
      ? { database_id: parentDatabaseId }
      : { page_id: parentPageId },
    properties,
  };
  if (children) body.children = children;

  const page = await notionFetch(params.accessToken, '/pages', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    id: String(page.id ?? ''),
    url: typeof page.url === 'string' ? page.url : '',
    title: extractPageTitle(page) || params.title.trim() || 'Untitled',
  };
}

export async function notionAppendPageContent(params: {
  accessToken: string;
  pageId: string;
  contentMarkdown: string;
  title?: string;
}): Promise<{ id: string; url: string; title: string; appendedBlocks: number }> {
  const pageId = params.pageId.trim();
  const markdown = params.contentMarkdown.trim();
  let appendedBlocks = 0;
  if (markdown) {
    const blocks = markdownToBlocks(markdown);
    await notionFetch(params.accessToken, `/blocks/${encodeURIComponent(pageId)}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks }),
    });
    appendedBlocks = blocks.length;
  }

  if (params.title?.trim()) {
    await notionFetch(params.accessToken, `/pages/${encodeURIComponent(pageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          title: { title: richText(params.title.trim()) },
        },
      }),
    });
  }

  const page = await notionFetch(params.accessToken, `/pages/${encodeURIComponent(pageId)}`);
  return {
    id: String(page.id ?? pageId),
    url: typeof page.url === 'string' ? page.url : '',
    title: extractPageTitle(page),
    appendedBlocks,
  };
}

export async function notionCreateDatabaseRow(params: {
  accessToken: string;
  databaseId: string;
  title?: string;
  properties?: Record<string, unknown>;
  contentMarkdown?: string;
}): Promise<{ id: string; url: string; title: string }> {
  return notionCreatePage({
    accessToken: params.accessToken,
    parentDatabaseId: params.databaseId,
    title: params.title?.trim() || 'Untitled',
    properties: params.properties,
    contentMarkdown: params.contentMarkdown,
  });
}
