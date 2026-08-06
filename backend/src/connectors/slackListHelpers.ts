import { slackApiGet, slackApiPostJson } from './slackApi.service.js';

export interface SlackListSelectChoice {
  value: string;
  label: string;
}

export interface SlackListColumn {
  id: string;
  name: string;
  key: string;
  type: string;
  isPrimary: boolean;
  selectChoices?: SlackListSelectChoice[];
}

export interface SlackListSchema {
  listId: string;
  title: string | null;
  todoMode: boolean;
  columns: SlackListColumn[];
}

export function slackListRichText(text: string): Record<string, unknown>[] {
  return [
    {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [{ type: 'text', text }],
        },
      ],
    },
  ];
}

function mapSchemaColumns(schema: unknown): SlackListColumn[] {
  if (!Array.isArray(schema)) return [];
  return schema
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    .map((c) => {
      const options = c.options as Record<string, unknown> | undefined;
      const rawChoices = Array.isArray(options?.choices) ? options.choices : [];
      const selectChoices = rawChoices
        .filter((ch): ch is Record<string, unknown> => Boolean(ch) && typeof ch === 'object')
        .map((ch) => ({
          value: String(ch.value ?? ''),
          label: String(ch.label ?? ch.value ?? ''),
        }))
        .filter((ch) => ch.value);
      return {
        id: String(c.id ?? ''),
        name: String(c.name ?? c.key ?? ''),
        key: String(c.key ?? ''),
        type: String(c.type ?? 'text'),
        isPrimary: Boolean(c.is_primary_column),
        selectChoices: selectChoices.length > 0 ? selectChoices : undefined,
      };
    })
    .filter((c) => c.id);
}

function parseListSchemaFromFile(file: Record<string, unknown>, listId: string): SlackListSchema | null {
  const meta = file.list_metadata as Record<string, unknown> | undefined;
  const columns = mapSchemaColumns(meta?.schema);
  if (columns.length === 0) return null;
  return {
    listId,
    title: typeof file.title === 'string' ? file.title : null,
    todoMode: Boolean(meta?.todo_mode),
    columns,
  };
}

function parseListSchemaFromInfo(list: Record<string, unknown>, listId: string): SlackListSchema | null {
  const meta = list.list_metadata as Record<string, unknown> | undefined;
  const columns = mapSchemaColumns(meta?.schema);
  if (columns.length === 0) return null;
  return {
    listId,
    title: typeof list.title === 'string' ? list.title : null,
    todoMode: Boolean(meta?.todo_mode),
    columns,
  };
}

export async function fetchSlackListSchema(token: string, listId: string): Promise<SlackListSchema> {
  try {
    const fi = await slackApiGet(token, 'files.info', { file: listId });
    const file = fi.file as Record<string, unknown> | undefined;
    if (file) {
      const parsed = parseListSchemaFromFile(file, listId);
      if (parsed) return parsed;
    }
  } catch {
    // files.info may require files:read — fall back to items.info
  }

  const listed = await slackApiPostJson(token, 'slackLists.items.list', {
    list_id: listId,
    limit: 1,
  });
  const items = listed.items as Array<{ id?: string }> | undefined;
  const firstId = items?.[0]?.id;
  if (firstId) {
    const info = await slackApiPostJson(token, 'slackLists.items.info', {
      list_id: listId,
      id: firstId,
    });
    const list = info.list as Record<string, unknown> | undefined;
    if (list) {
      const parsed = parseListSchemaFromInfo(list, listId);
      if (parsed) return parsed;
    }
  }

  throw new Error(
    'Could not load list schema. Confirm list_id (starts with F…) and that lists:read is granted, then reconnect Slack.',
  );
}

export function findListColumn(
  columns: SlackListColumn[],
  matchers: Array<(c: SlackListColumn) => boolean>,
): SlackListColumn | undefined {
  for (const match of matchers) {
    const col = columns.find(match);
    if (col) return col;
  }
  return undefined;
}

export function buildListItemInitialFields(params: {
  schema: SlackListSchema;
  title: string;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  completed?: boolean | null;
}): Record<string, unknown>[] {
  const { schema, title } = params;
  const fields: Record<string, unknown>[] = [];

  const primary =
    findListColumn(schema.columns, [(c) => c.isPrimary]) ??
    findListColumn(schema.columns, [(c) => c.type === 'text' || c.key === 'title']);

  if (!primary) {
    throw new Error('List has no primary/title column — call slack_describe_list first.');
  }

  fields.push({
    column_id: primary.id,
    rich_text: slackListRichText(title),
  });

  if (params.assigneeUserId) {
    const assigneeCol = findListColumn(schema.columns, [
      (c) => c.type === 'todo_assignee' || c.type === 'assignee',
      (c) => c.key === 'todo_assignee' || c.key === 'assignee' || c.key === 'owner',
      (c) => c.type === 'user' && c.name.toLowerCase().includes('assign'),
    ]);
    if (assigneeCol) {
      fields.push({ column_id: assigneeCol.id, user: [params.assigneeUserId] });
    }
  }

  if (params.dueDate) {
    const dueCol = findListColumn(schema.columns, [
      (c) => c.type === 'todo_due_date' || c.type === 'due_date',
      (c) => c.key === 'todo_due_date' || c.key === 'due_date' || c.key === 'date',
    ]);
    if (dueCol) {
      fields.push({ column_id: dueCol.id, date: [params.dueDate] });
    }
  }

  if (params.completed === true) {
    const doneCol = findListColumn(schema.columns, [
      (c) => c.type === 'todo_completed' || c.type === 'completed',
      (c) => c.key === 'todo_completed' || c.key === 'completed',
    ]);
    if (doneCol) {
      fields.push({ column_id: doneCol.id, checkbox: true });
    }
  }

  return fields;
}

export function resolveSelectChoiceValue(column: SlackListColumn, labelOrValue: string): string | null {
  const want = labelOrValue.trim().toLowerCase();
  if (!want) return null;
  for (const choice of column.selectChoices ?? []) {
    const value = choice.value.toLowerCase();
    const label = choice.label.toLowerCase();
    if (value === want || label === want) return choice.value;
  }
  return null;
}

export interface SlackListItemMatch {
  itemId: string;
  title: string | null;
}

export async function findSlackListItemByTitle(
  token: string,
  listId: string,
  taskTitle: string,
): Promise<SlackListItemMatch[]> {
  const want = taskTitle.trim().toLowerCase();
  if (!want) return [];

  let cursor: string | undefined;
  const matches: SlackListItemMatch[] = [];
  for (let page = 0; page < 10; page += 1) {
    const resp = await slackApiPostJson(token, 'slackLists.items.list', {
      list_id: listId,
      limit: 100,
      cursor,
    });
    const items = Array.isArray(resp.items) ? resp.items : [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const fields = Array.isArray(item.fields) ? item.fields : [];
      for (const fieldRaw of fields) {
        if (!fieldRaw || typeof fieldRaw !== 'object') continue;
        const field = fieldRaw as Record<string, unknown>;
        const text = typeof field.text === 'string' ? field.text.trim().toLowerCase() : '';
        if (text === want) {
          const itemId = String(item.id ?? '');
          if (itemId) {
            matches.push({ itemId, title: typeof field.text === 'string' ? field.text : null });
          }
        }
      }
    }
    const meta = resp.response_metadata as Record<string, unknown> | undefined;
    cursor = typeof meta?.next_cursor === 'string' && meta.next_cursor ? meta.next_cursor : undefined;
    if (!cursor) break;
  }
  return matches;
}

export interface SlackChannelListRef {
  listId: string;
  title: string | null;
  tabLabel: string | null;
  todoMode: boolean | null;
  source: 'channel_tab' | 'shared_file';
}

function isSlackListFileId(id: string): boolean {
  return /^F[A-Z0-9]+$/i.test(id);
}

function normalizeListTitle(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Find Slack Lists (project tracker tabs) attached to a channel. */
export async function discoverSlackChannelLists(
  token: string,
  channelId: string,
): Promise<SlackChannelListRef[]> {
  const seen = new Set<string>();
  const out: SlackChannelListRef[] = [];

  const add = (entry: SlackChannelListRef) => {
    if (!isSlackListFileId(entry.listId) || seen.has(entry.listId)) return;
    seen.add(entry.listId);
    out.push(entry);
  };

  try {
    const info = await slackApiGet(token, 'conversations.info', { channel: channelId });
    const channel = info.channel as Record<string, unknown> | undefined;
    const props = channel?.properties as Record<string, unknown> | undefined;
    const tabs = props?.tabs ?? props?.tabz;
    if (Array.isArray(tabs)) {
      for (const tab of tabs) {
        if (!tab || typeof tab !== 'object') continue;
        const row = tab as Record<string, unknown>;
        const type = String(row.type ?? '').toLowerCase();
        const id = String(row.id ?? '');
        const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : null;
        const data = row.data as Record<string, unknown> | undefined;
        const fileId = typeof data?.file_id === 'string' ? data.file_id : '';
        if (type.includes('list') && isSlackListFileId(fileId)) {
          add({
            listId: fileId,
            title: label,
            tabLabel: label,
            todoMode: null,
            source: 'channel_tab',
          });
          continue;
        }
        if (type.includes('list') && isSlackListFileId(id)) {
          add({
            listId: id,
            title: label,
            tabLabel: label,
            todoMode: null,
            source: 'channel_tab',
          });
        }
      }
    }

    const recordChannel = props?.record_channel as Record<string, unknown> | undefined;
    const recordId = String(recordChannel?.record_id ?? '');
    const recordType = String(recordChannel?.record_type ?? '').toLowerCase();
    if (recordId && (recordType.includes('list') || isSlackListFileId(recordId))) {
      add({
        listId: recordId,
        title: typeof recordChannel?.record_label === 'string' ? recordChannel.record_label : null,
        tabLabel: null,
        todoMode: null,
        source: 'channel_tab',
      });
    }
  } catch {
    // conversations.info may omit tabs — fall back to files.list
  }

  try {
    let page = 1;
    for (let i = 0; i < 5; i += 1) {
      const resp = await slackApiGet(token, 'files.list', {
        channel: channelId,
        count: 100,
        page,
        types: 'all',
      });
      const files = Array.isArray(resp.files) ? resp.files : [];
      for (const raw of files) {
        if (!raw || typeof raw !== 'object') continue;
        const file = raw as Record<string, unknown>;
        const meta = file.list_metadata as Record<string, unknown> | undefined;
        if (!meta?.schema) continue;
        const id = String(file.id ?? '');
        const title = typeof file.title === 'string' ? file.title : null;
        add({
          listId: id,
          title,
          tabLabel: null,
          todoMode: Boolean(meta.todo_mode),
          source: 'shared_file',
        });
      }
      const paging = resp.paging as Record<string, unknown> | undefined;
      const pages = typeof paging?.pages === 'number' ? paging.pages : 1;
      if (page >= pages) break;
      page += 1;
    }
  } catch {
    // files:read may be missing until Slack is reconnected
  }

  return out;
}

/** Pick the best list for a channel (project tracker / todo list). */
export function pickSlackChannelList(
  lists: SlackChannelListRef[],
  listTitle?: string | null,
): { list: SlackChannelListRef | null; candidates: SlackChannelListRef[] } {
  if (lists.length === 0) return { list: null, candidates: [] };
  const want = normalizeListTitle(listTitle);
  if (want) {
    const exact = lists.filter(
      (l) => normalizeListTitle(l.title) === want || normalizeListTitle(l.tabLabel) === want,
    );
    if (exact.length === 1) return { list: exact[0], candidates: [] };
    if (exact.length > 1) return { list: null, candidates: exact };
    // Slack's channel tab label can be blank. A single attached List is unambiguous
    // even when its metadata cannot confirm the requested display title.
    if (lists.length === 1) return { list: lists[0], candidates: [] };
    return { list: null, candidates: lists };
  }

  if (lists.length === 1) return { list: lists[0], candidates: [] };

  const trackers = lists.filter((l) => {
    const label = `${l.tabLabel ?? ''} ${l.title ?? ''}`.toLowerCase();
    return label.includes('project tracker') || label.includes('tracker') || l.todoMode === true;
  });
  return trackers.length === 1 ? { list: trackers[0], candidates: [] } : { list: null, candidates: trackers.length ? trackers : lists };
}

export function simplifyListItem(row: Record<string, unknown>) {
  const fields = Array.isArray(row.fields) ? row.fields : [];
  const cells: Record<string, unknown> = {};
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const key = String(f.key ?? f.column_id ?? 'field');
    cells[key] =
      f.text ??
      f.value ??
      f.user ??
      f.date ??
      f.checkbox ??
      f.select ??
      null;
  }
  return {
    id: String(row.id ?? ''),
    listId: String(row.list_id ?? ''),
    createdAt: row.date_created ?? null,
    archived: row.archived ?? false,
    fields: cells,
  };
}
