import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import { SLACK_CONNECT_INSTRUCTIONS, slackConnectorNotConnectedMessage } from './connectorUserMessages.js';
import { ConnectorNotConfiguredError } from './emailTool.service.js';
import { JitService } from '../jit/jit.service.js';
import { refreshSlackSession, resolveSlackSession } from './slackConnector.service.js';
import { SlackApiError, slackApiGet, slackApiPostJson } from './slackApi.service.js';
import { saveSlackFocus } from './slackFocus.service.js';
import {
  buildListItemInitialFields,
  discoverSlackChannelLists,
  fetchSlackListSchema,
  findSlackListItemByTitle,
  pickSlackChannelList,
  resolveSelectChoiceValue,
  simplifyListItem,
  slackListRichText,
} from './slackListHelpers.js';
import type { SlackSession } from './slackConnector.service.js';

export { SLACK_CONNECT_INSTRUCTIONS };

export class SlackScopeDeniedError extends Error {
  readonly code = 'scope_denied';
  constructor(scope: string) {
    super(`Agent lacks effective scope: ${scope}`);
  }
}

export class SlackToolError extends Error {
  readonly code = 'slack_tool_failed';
}

const actionsService = new ActionsService();
const jitService = new JitService();

function effectiveScopes(params: {
  permissionScopes: string[];
  alwaysScopes: string[];
  jitScopes: string[];
  runSkills: string[];
}): Set<string> {
  const granted = new Set([...params.permissionScopes, ...params.alwaysScopes]);
  if (params.runSkills.length > 0) {
    return new Set([...granted].filter((s) => params.runSkills.includes(s)));
  }
  return granted;
}

async function loadAgentRunContext(agentId: string, runId: string | null) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      userId: true,
      orgId: true,
      permissionScopes: true,
      alwaysScopes: true,
      jitScopes: true,
      user: { select: { orgId: true } },
    },
  });
  if (!agent) throw new SlackToolError('Agent not found');

  let runSkills: string[] = [];
  let teamRunId: string | null = null;
  if (runId) {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: { skills: true, teamRunId: true, agentId: true },
    });
    if (run && run.agentId === agentId) {
      runSkills = run.skills;
      teamRunId = run.teamRunId;
    }
  }

  return {
    runSkills,
    teamRunId,
    userId: agent.userId,
    orgId: agent.orgId ?? agent.user.orgId,
    permissionScopes: agent.permissionScopes,
    alwaysScopes: agent.alwaysScopes,
    jitScopes: agent.jitScopes,
  };
}

async function assertSlackJit(params: {
  agentId: string;
  runId: string | null;
  ctx: Awaited<ReturnType<typeof loadAgentRunContext>>;
  jitScope: PermissionScope;
  jitToken?: string | null;
}): Promise<void> {
  const jitAutoApprove =
    process.env.QLIX_JIT_AUTO_APPROVE === '1' || process.env.QLIX_JIT_AUTO_APPROVE === 'true';
  const needsJit =
    !jitAutoApprove &&
    (params.ctx.jitScopes as PermissionScope[]).includes(params.jitScope) &&
    !(params.ctx.alwaysScopes as PermissionScope[]).includes(params.jitScope);

  if (!needsJit) return;

  const token = params.jitToken?.trim();
  if (!token) {
    const sessionGranted = await jitService.hasActiveConversationGrantForRun(params.runId, params.jitScope);
    if (!sessionGranted) {
      throw new JitTokenRequiredError(
        `${params.jitScope} requires approval in chat — Approve the pending request in this conversation`,
      );
    }
    await jitService.touchConversationGrantForRun(params.runId, params.jitScope);
    return;
  }

  const ok = await actionsService.consumeJitToken({
    agentId: params.agentId,
    actionType: params.jitScope,
    token,
  });
  if (!ok) throw new JitTokenInvalidError(`Invalid or already used jitToken for ${params.jitScope}`);
}

type SlackActionType = 'slack.read' | 'slack.send';

async function runSlackTool<T>(params: {
  agentId: string;
  runId: string | null;
  tool: string;
  requiredScope: SlackActionType;
  jitScope?: SlackActionType;
  jitToken?: string | null;
  riskLevel: 'low' | 'medium' | 'high';
  payload: Record<string, unknown>;
  execute: (session: SlackSession) => Promise<T>;
}): Promise<T> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveScopes(ctx);
  if (!scopes.has(params.requiredScope)) {
    throw new SlackScopeDeniedError(params.requiredScope);
  }

  if (params.jitScope) {
    await assertSlackJit({
      agentId: params.agentId,
      runId: params.runId,
      ctx,
      jitScope: params.jitScope,
      jitToken: params.jitToken,
    });
  }

  let session = await resolveSlackSession(ctx.orgId);
  session = await refreshSlackSession(session);
  const token = session.credentials.accessToken;

  try {
    const result = await params.execute(session);
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: params.requiredScope,
      payload: { tool: params.tool, ...params.payload },
      status: 'success',
      riskLevel: params.riskLevel,
      teamRunId: ctx.teamRunId,
    });
    return result;
  } catch (err) {
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: params.requiredScope,
      payload: { tool: params.tool, error: String(err), ...params.payload },
      status: 'failed',
      riskLevel: params.riskLevel,
      teamRunId: ctx.teamRunId,
    });
    throw err;
  } finally {
    void token;
  }
}

function mapChannel(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    isPrivate: Boolean(row.is_private),
    isMember: Boolean(row.is_member),
    numMembers: typeof row.num_members === 'number' ? row.num_members : null,
  };
}

/** Accept channel id (C…/G…/D…) or name (#todo / todo) and return a Slack channel id. */
async function resolveSlackChannelRef(token: string, channelRef: string): Promise<string> {
  const ref = channelRef.trim();
  if (/^[CGD][A-Z0-9]+$/i.test(ref)) return ref;
  const name = ref.replace(/^#/, '').toLowerCase();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const resp = await slackApiGet(token, 'conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000,
      cursor,
    });
    const channels = Array.isArray(resp.channels) ? resp.channels : [];
    for (const c of channels) {
      if (!c || typeof c !== 'object') continue;
      const row = c as Record<string, unknown>;
      if (String(row.name ?? '').toLowerCase() === name) {
        const id = String(row.id ?? '');
        if (id) return id;
      }
    }
    const meta = resp.response_metadata as Record<string, unknown> | undefined;
    cursor = typeof meta?.next_cursor === 'string' && meta.next_cursor ? meta.next_cursor : undefined;
    if (!cursor) break;
  }
  throw new SlackApiError(
    `No Slack channel named "${ref.replace(/^#/, '')}". Use slack_list_channels for ids/names.`,
    'channel_not_found',
  );
}

export async function executeSlackListChannels(params: {
  agentId: string;
  runId?: string | null;
  types?: string;
  limit?: number;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_list_channels',
    requiredScope: 'slack.read',
    riskLevel: 'low',
    payload: { types: params.types, limit: params.limit },
    execute: async (session) => {
      const resp = await slackApiGet(session.credentials.accessToken, 'conversations.list', {
        types: params.types ?? 'public_channel,private_channel',
        exclude_archived: true,
        limit: Math.min(params.limit ?? 200, 1000),
      });
      const channels = Array.isArray(resp.channels) ? resp.channels : [];
      return {
        teamId: session.credentials.teamId ?? null,
        teamName: session.credentials.teamName ?? null,
        channels: channels
          .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
          .map(mapChannel),
      };
    },
  });
}

export async function executeSlackSearchMessages(params: {
  agentId: string;
  runId?: string | null;
  query: string;
  count?: number;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_search_messages',
    requiredScope: 'slack.read',
    riskLevel: 'low',
    payload: { query: params.query, count: params.count },
    execute: async (session) => {
      const resp = await slackApiGet(session.credentials.accessToken, 'search.messages', {
        query: params.query,
        count: Math.min(params.count ?? 20, 100),
      });
      const matches = (resp.messages as Record<string, unknown> | undefined)?.matches;
      const rows = Array.isArray(matches) ? matches : [];
      return {
        query: params.query,
        total: (resp.messages as Record<string, unknown> | undefined)?.total ?? rows.length,
        messages: rows
          .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
          .map((m) => ({
            text: String(m.text ?? ''),
            user: m.user ?? m.username ?? null,
            channel: (m.channel as Record<string, unknown> | undefined)?.id ?? m.channel ?? null,
            channelName: (m.channel as Record<string, unknown> | undefined)?.name ?? null,
            ts: m.ts ?? null,
            permalink: m.permalink ?? null,
          })),
      };
    },
  });
}

export async function executeSlackGetHistory(params: {
  agentId: string;
  runId?: string | null;
  channel: string;
  limit?: number;
  oldest?: string;
  latest?: string;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_get_history',
    requiredScope: 'slack.read',
    riskLevel: 'low',
    payload: {
      channel: params.channel,
      limit: params.limit,
      oldest: params.oldest,
      latest: params.latest,
    },
    execute: async (session) => {
      const channelId = await resolveSlackChannelRef(session.credentials.accessToken, params.channel);
      const resp = await slackApiGet(session.credentials.accessToken, 'conversations.history', {
        channel: channelId,
        limit: Math.min(params.limit ?? 50, 200),
        oldest: params.oldest,
        latest: params.latest,
      });
      const messages = Array.isArray(resp.messages) ? resp.messages : [];
      return {
        channel: params.channel,
        messages: messages
          .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
          .map((m) => ({
            text: String(m.text ?? ''),
            user: m.user ?? null,
            ts: m.ts ?? null,
            threadTs: m.thread_ts ?? null,
          })),
      };
    },
  });
}

export async function executeSlackPostMessage(params: {
  agentId: string;
  runId?: string | null;
  channel: string;
  text: string;
  threadTs?: string | null;
  jitToken?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_post_message',
    requiredScope: 'slack.send',
    jitScope: 'slack.send',
    jitToken: params.jitToken,
    riskLevel: 'medium',
    payload: {
      channel: params.channel,
      text: params.text.slice(0, 500),
      threadTs: params.threadTs ?? null,
    },
    execute: async (session) => {
      const channelId = await resolveSlackChannelRef(session.credentials.accessToken, params.channel);
      const body: Record<string, unknown> = {
        channel: channelId,
        text: params.text,
      };
      if (params.threadTs) body.thread_ts = params.threadTs;
      const resp = await slackApiPostJson(session.credentials.accessToken, 'chat.postMessage', body);
      return {
        ok: true,
        channel: resp.channel ?? channelId,
        channelRef: params.channel,
        ts: resp.ts ?? null,
        teamId: session.credentials.teamId ?? null,
      };
    },
  });
}

export async function executeSlackListUsers(params: {
  agentId: string;
  runId?: string | null;
  limit?: number;
  cursor?: string;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_list_users',
    requiredScope: 'slack.read',
    riskLevel: 'low',
    payload: { limit: params.limit, cursor: params.cursor },
    execute: async (session) => {
      const resp = await slackApiGet(session.credentials.accessToken, 'users.list', {
        limit: Math.min(params.limit ?? 200, 1000),
        cursor: params.cursor,
      });
      const members = Array.isArray(resp.members) ? resp.members : [];
      return {
        members: members
          .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
          .filter((m) => !m.is_bot && !m.deleted)
          .map((m) => {
            const profile = m.profile as Record<string, unknown> | undefined;
            return {
              id: String(m.id ?? ''),
              name: String(m.name ?? ''),
              realName: profile?.real_name ?? m.real_name ?? null,
              email: profile?.email ?? null,
            };
          }),
        nextCursor: (resp.response_metadata as Record<string, unknown> | undefined)?.next_cursor ?? null,
      };
    },
  });
}

export async function executeSlackCreateChannel(params: {
  agentId: string;
  runId?: string | null;
  name: string;
  isPrivate?: boolean;
  jitToken?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_create_channel',
    requiredScope: 'slack.send',
    jitScope: 'slack.send',
    jitToken: params.jitToken,
    riskLevel: 'medium',
    payload: { name: params.name, isPrivate: params.isPrivate ?? false },
    execute: async (session) => {
      const resp = await slackApiPostJson(session.credentials.accessToken, 'conversations.create', {
        name: params.name.replace(/^#/, '').slice(0, 80),
        is_private: Boolean(params.isPrivate),
      });
      const channel = resp.channel as Record<string, unknown> | undefined;
      return {
        ok: true,
        id: channel?.id ?? null,
        name: channel?.name ?? params.name,
        isPrivate: Boolean(channel?.is_private ?? params.isPrivate),
      };
    },
  });
}

export async function executeSlackSetChannelTopic(params: {
  agentId: string;
  runId?: string | null;
  channel: string;
  topic: string;
  jitToken?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_set_channel_topic',
    requiredScope: 'slack.send',
    jitScope: 'slack.send',
    jitToken: params.jitToken,
    riskLevel: 'low',
    payload: { channel: params.channel, topic: params.topic.slice(0, 200) },
    execute: async (session) => {
      await slackApiPostJson(session.credentials.accessToken, 'conversations.setTopic', {
        channel: params.channel,
        topic: params.topic.slice(0, 250),
      });
      return { ok: true, channel: params.channel, topic: params.topic };
    },
  });
}

export async function executeSlackOpenDm(params: {
  agentId: string;
  runId?: string | null;
  userId: string;
  jitToken?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_open_dm',
    requiredScope: 'slack.send',
    jitScope: 'slack.send',
    jitToken: params.jitToken,
    riskLevel: 'medium',
    payload: { userId: params.userId },
    execute: async (session) => {
      const resp = await slackApiPostJson(session.credentials.accessToken, 'conversations.open', {
        users: params.userId,
      });
      const channel = resp.channel as Record<string, unknown> | undefined;
      return {
        ok: true,
        channelId: channel?.id ?? null,
        userId: params.userId,
      };
    },
  });
}

export async function executeSlackSetPresence(params: {
  agentId: string;
  runId?: string | null;
  presence: 'auto' | 'away';
  jitToken?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_set_presence',
    requiredScope: 'slack.send',
    jitScope: 'slack.send',
    jitToken: params.jitToken,
    riskLevel: 'low',
    payload: { presence: params.presence },
    execute: async (session) => {
      await slackApiPostJson(session.credentials.accessToken, 'users.setPresence', {
        presence: params.presence,
      });
      return { ok: true, presence: params.presence };
    },
  });
}

export async function executeSlackFindChannelLists(params: {
  agentId: string;
  runId?: string | null;
  channel: string;
  listTitle?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_find_channel_lists',
    requiredScope: 'slack.read',
    riskLevel: 'low',
    payload: { channel: params.channel, listTitle: params.listTitle ?? null },
    execute: async (session) => {
      const token = session.credentials.accessToken;
      const channelId = await resolveSlackChannelRef(token, params.channel);
      const lists = await discoverSlackChannelLists(token, channelId);
      const picked = pickSlackChannelList(lists, params.listTitle ?? null);
      const candidates = picked.candidates.map((l) => ({
        listId: l.listId,
        title: l.title,
        tabLabel: l.tabLabel,
      }));
      return {
        channel: params.channel,
        channelId,
        lists: lists.map((l) => ({
          listId: l.listId,
          title: l.title,
          tabLabel: l.tabLabel,
          todoMode: l.todoMode,
          source: l.source,
        })),
        recommendedListId: picked.list?.listId ?? null,
        recommendedTitle: picked.list?.title ?? picked.list?.tabLabel ?? null,
        ambiguous: candidates.length > 0,
        candidates,
        hint:
          lists.length === 0
            ? 'No project tracker / Slack List found on this channel. Add a List tab in Slack, reconnect Slack (files:read), then retry.'
            : candidates.length > 0
              ? 'Multiple Lists match. Ask the user to choose a list title, then retry with listTitle.'
              : 'Use recommendedListId (F…) with slack_create_list_item — this adds a task row, not a chat message.',
      };
    },
  });
}

async function resolveSlackListIdForChannel(params: {
  token: string;
  channel?: string | null;
  listId?: string | null;
  listTitle?: string | null;
}): Promise<{ listId: string; listTitle: string | null; channelId: string | null }> {
  const channelRef = params.channel?.trim() ?? '';
  if (channelRef) {
    const channelId = await resolveSlackChannelRef(params.token, channelRef);
    const lists = await discoverSlackChannelLists(params.token, channelId);
    const picked = pickSlackChannelList(lists, params.listTitle ?? null);
    if (picked.candidates.length > 0) {
      const options = picked.candidates
        .map((l) => `"${l.title ?? l.tabLabel ?? l.listId}"`)
        .join(', ');
      throw new SlackApiError(`Multiple Slack Lists match this channel. Choose one: ${options}`, 'multiple_trackers');
    }
    if (!picked.list) {
      throw new SlackApiError(
        `No Slack List (project tracker) on channel "${channelRef}". ` +
          'Call slack_find_channel_lists or add a List tab in Slack.',
        'list_not_found',
      );
    }
    return {
      listId: picked.list.listId,
      listTitle: picked.list.title ?? picked.list.tabLabel,
      channelId,
    };
  }

  const listId = params.listId?.trim() ?? '';
  if (listId && isSlackListFileId(listId)) {
    return { listId, listTitle: params.listTitle ?? null, channelId: null };
  }

  if (listId) {
    const channelId = await resolveSlackChannelRef(params.token, listId);
    const lists = await discoverSlackChannelLists(params.token, channelId);
    const picked = pickSlackChannelList(lists, params.listTitle ?? null);
    if (picked.candidates.length > 0) {
      const options = picked.candidates
        .map((l) => `"${l.title ?? l.tabLabel ?? l.listId}"`)
        .join(', ');
      throw new SlackApiError(`Multiple Slack Lists match this channel. Choose one: ${options}`, 'multiple_trackers');
    }
    if (!picked.list) {
      throw new SlackApiError(
        `No Slack List (project tracker) on channel "${listId}". ` +
          'Call slack_find_channel_lists or add a List tab in Slack.',
        'list_not_found',
      );
    }
    return {
      listId: picked.list.listId,
      listTitle: picked.list.title ?? picked.list.tabLabel,
      channelId,
    };
  }

  throw new Error('Provide channel (#todo) or listId (F…) for slack_create_list_item.');
}

function isSlackListItemId(id: string): boolean {
  return /^Rec[A-Z0-9]+$/i.test(id);
}

async function resolveSlackListItemId(params: {
  token: string;
  listId: string;
  itemId?: string | null;
  taskTitle?: string | null;
}): Promise<string> {
  const itemId = params.itemId?.trim() ?? '';
  if (itemId && isSlackListItemId(itemId)) return itemId;

  const taskTitle = (params.taskTitle ?? itemId).trim();
  if (!taskTitle) {
    throw new Error('Provide taskTitle or itemId (Rec…) to update a list row.');
  }

  const matches = await findSlackListItemByTitle(params.token, params.listId, taskTitle);
  if (matches.length === 0) {
    throw new SlackApiError(`No list item titled "${taskTitle}"`, 'item_not_found');
  }
  if (matches.length > 1) {
    throw new SlackApiError(
      `Multiple list items are titled "${taskTitle}". Choose one by its itemId: ${matches.map((m) => m.itemId).join(', ')}`,
      'multiple_tasks',
    );
  }
  return matches[0].itemId;
}

function isSlackListFileId(id: string): boolean {
  return /^F[A-Z0-9]+$/i.test(id);
}

export async function executeSlackDescribeList(params: {
  agentId: string;
  runId?: string | null;
  listId?: string | null;
  channel?: string | null;
  listTitle?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_describe_list',
    requiredScope: 'slack.read',
    riskLevel: 'low',
    payload: {
      listId: params.listId ?? null,
      channel: params.channel ?? null,
      listTitle: params.listTitle ?? null,
    },
    execute: async (session) => {
      const token = session.credentials.accessToken;
      const resolved = await resolveSlackListIdForChannel({
        token,
        channel: params.channel,
        listId: params.listId,
        listTitle: params.listTitle,
      });
      const schema = await fetchSlackListSchema(token, resolved.listId);
      return {
        listId: schema.listId,
        channel: params.channel ?? null,
        channelId: resolved.channelId,
        title: schema.title,
        todoMode: schema.todoMode,
        columns: schema.columns.map((c) => ({
          id: c.id,
          name: c.name,
          key: c.key,
          type: c.type,
          isPrimary: c.isPrimary,
          options:
            c.selectChoices?.map((choice) => ({
              value: choice.value,
              label: choice.label,
            })) ?? null,
        })),
        hint: 'Use slack_update_list_item(channel, taskTitle, status=...) — taskTitle is the task name, not itemId.',
      };
    },
  });
}

export async function executeSlackListListItems(params: {
  agentId: string;
  runId?: string | null;
  listId?: string | null;
  channel?: string | null;
  listTitle?: string | null;
  query?: string | null;
  status?: string | null;
  completed?: boolean | null;
  limit?: number;
  cursor?: string;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_list_list_items',
    requiredScope: 'slack.read',
    riskLevel: 'low',
    payload: {
      listId: params.listId ?? null,
      channel: params.channel ?? null,
      listTitle: params.listTitle ?? null,
      query: params.query ?? null,
      status: params.status ?? null,
      completed: params.completed ?? null,
      limit: params.limit,
      cursor: params.cursor,
    },
    execute: async (session) => {
      const token = session.credentials.accessToken;
      const resolved = await resolveSlackListIdForChannel({
        token,
        channel: params.channel,
        listId: params.listId,
        listTitle: params.listTitle,
      });
      const schema = await fetchSlackListSchema(token, resolved.listId);
      const resp = await slackApiPostJson(token, 'slackLists.items.list', {
        list_id: resolved.listId,
        limit: Math.min(params.limit ?? 50, 200),
        cursor: params.cursor,
      });
      const items = Array.isArray(resp.items) ? resp.items : [];
      const meta = resp.response_metadata as Record<string, unknown> | undefined;
      const statusColumn =
        schema.columns.find((c) => c.type === 'select' && c.name.toLowerCase().includes('status')) ??
        schema.columns.find((c) => c.type === 'select');
      const wantedStatus = statusColumn && params.status
        ? resolveSelectChoiceValue(statusColumn, params.status)
        : null;
      if (params.status && statusColumn && !wantedStatus) {
        throw new SlackApiError(`Unknown status "${params.status}"`, 'invalid_status');
      }
      const query = params.query?.trim().toLowerCase();
      const filtered = items.filter((raw) => {
        if (!raw || typeof raw !== 'object') return false;
        const row = raw as Record<string, unknown>;
        const fields = Array.isArray(row.fields) ? row.fields : [];
        const titleMatches =
          !query ||
          fields.some(
            (field) =>
              Boolean(field) &&
              typeof field === 'object' &&
              typeof (field as Record<string, unknown>).text === 'string' &&
              String((field as Record<string, unknown>).text).toLowerCase().includes(query),
          );
        const statusMatches =
          !wantedStatus ||
          fields.some(
            (field) =>
              Boolean(field) &&
              typeof field === 'object' &&
              String((field as Record<string, unknown>).column_id ?? '') === statusColumn?.id &&
              Array.isArray((field as Record<string, unknown>).select) &&
              ((field as Record<string, unknown>).select as unknown[]).includes(wantedStatus),
          );
        const completedMatches =
          params.completed === undefined ||
          params.completed === null ||
          fields.some(
            (field) =>
              Boolean(field) &&
              typeof field === 'object' &&
              Boolean((field as Record<string, unknown>).checkbox) === params.completed,
          );
        return titleMatches && statusMatches && completedMatches;
      });
      return {
        listId: resolved.listId,
        channel: params.channel ?? null,
        items: filtered
          .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === 'object')
          .map(simplifyListItem),
        nextCursor: meta?.next_cursor ?? null,
      };
    },
  });
}

export async function executeSlackCreateListItem(params: {
  agentId: string;
  runId?: string | null;
  listId?: string | null;
  channel?: string | null;
  listTitle?: string | null;
  title: string;
  status?: string | null;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  completed?: boolean | null;
  jitToken?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_create_list_item',
    requiredScope: 'slack.send',
    jitScope: 'slack.send',
    jitToken: params.jitToken,
    riskLevel: 'medium',
    payload: {
      listId: params.listId ?? null,
      channel: params.channel ?? null,
      listTitle: params.listTitle ?? null,
      title: params.title.slice(0, 500),
      assigneeUserId: params.assigneeUserId ?? null,
      dueDate: params.dueDate ?? null,
      status: params.status ?? null,
    },
    execute: async (session) => {
      const token = session.credentials.accessToken;
      const resolved = await resolveSlackListIdForChannel({
        token,
        channel: params.channel,
        listId: params.listId,
        listTitle: params.listTitle,
      });
      const schema = await fetchSlackListSchema(token, resolved.listId);
      const initial_fields = buildListItemInitialFields({
        schema,
        title: params.title,
        assigneeUserId: params.assigneeUserId,
        dueDate: params.dueDate,
        completed: params.completed,
      });
      if (params.status) {
        const statusColumn =
          schema.columns.find((c) => c.type === 'select' && c.name.toLowerCase().includes('status')) ??
          schema.columns.find((c) => c.type === 'select');
        const statusValue = statusColumn ? resolveSelectChoiceValue(statusColumn, params.status) : null;
        if (!statusColumn || !statusValue) {
          throw new SlackApiError(`Unknown status "${params.status}"`, 'invalid_status');
        }
        initial_fields.push({ column_id: statusColumn.id, select: [statusValue] });
      }
      const resp = await slackApiPostJson(token, 'slackLists.items.create', {
        list_id: resolved.listId,
        initial_fields,
      });
      const item = resp.item as Record<string, unknown> | undefined;
      const record = resp.record as Record<string, unknown> | undefined;
      const itemId = String(item?.id ?? record?.id ?? resp.id ?? '') || null;
      await saveSlackFocus({
        agentId: params.agentId,
        runId: params.runId,
        focus: {
          channel: params.channel ?? resolved.channelId ?? resolved.listId,
          channelId: resolved.channelId,
          listId: resolved.listId,
          listTitle: schema.title ?? resolved.listTitle,
          itemId,
          taskTitle: params.title,
          status: params.status ?? null,
        },
      });
      return {
        ok: true,
        listId: resolved.listId,
        channel: params.channel ?? null,
        channelId: resolved.channelId || null,
        itemId,
        title: params.title,
        listTitle: schema.title ?? resolved.listTitle,
        hint: 'Save itemId (Rec…) for slack_update_list_item, or pass channel + taskTitle.',
      };
    },
  });
}

export async function executeSlackUpdateListItem(params: {
  agentId: string;
  runId?: string | null;
  listId?: string | null;
  channel?: string | null;
  listTitle?: string | null;
  itemId?: string | null;
  taskTitle?: string | null;
  title?: string | null;
  status?: string | null;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  completed?: boolean | null;
  jitToken?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_update_list_item',
    requiredScope: 'slack.send',
    jitScope: 'slack.send',
    jitToken: params.jitToken,
    riskLevel: 'medium',
    payload: {
      listId: params.listId ?? null,
      channel: params.channel ?? null,
      listTitle: params.listTitle ?? null,
      itemId: params.itemId ?? null,
      taskTitle: params.taskTitle ?? null,
      title: params.title?.slice(0, 500) ?? null,
      status: params.status ?? null,
      completed: params.completed ?? null,
    },
    execute: async (session) => {
      const token = session.credentials.accessToken;
      const resolved = await resolveSlackListIdForChannel({
        token,
        channel: params.channel,
        listId: params.listId,
        listTitle: params.listTitle,
      });
      const schema = await fetchSlackListSchema(token, resolved.listId);
      const itemId = await resolveSlackListItemId({
        token,
        listId: resolved.listId,
        itemId: params.itemId,
        taskTitle: params.taskTitle ?? params.title,
      });
      const cells: Record<string, unknown>[] = [];

      if (params.title) {
        const primary =
          schema.columns.find((c) => c.isPrimary) ??
          schema.columns.find((c) => c.type === 'text' || c.key === 'title' || c.key === 'name');
        if (primary) {
          cells.push({
            row_id: itemId,
            column_id: primary.id,
            rich_text: slackListRichText(params.title),
          });
        }
      }

      if (params.status) {
        const statusCol =
          schema.columns.find((c) => c.type === 'select' && c.name.toLowerCase().includes('status')) ??
          schema.columns.find((c) => c.type === 'select');
        if (statusCol) {
          const selectValue = resolveSelectChoiceValue(statusCol, params.status);
          if (!selectValue) {
            const labels = (statusCol.selectChoices ?? []).map((c) => c.label).join(', ');
            throw new Error(
              `Unknown status "${params.status}". Available: ${labels || 'none loaded — call slack_describe_list'}`,
            );
          }
          cells.push({ row_id: itemId, column_id: statusCol.id, select: [selectValue] });
        }
      }

      if (params.assigneeUserId) {
        const col = schema.columns.find(
          (c) =>
            c.type === 'todo_assignee' ||
            c.type === 'assignee' ||
            c.key === 'assignee' ||
            c.key === 'owner',
        );
        if (col) {
          cells.push({
            row_id: itemId,
            column_id: col.id,
            user: [params.assigneeUserId],
          });
        }
      }

      if (params.dueDate) {
        const col = schema.columns.find(
          (c) => c.type === 'todo_due_date' || c.type === 'due_date' || c.key === 'due_date',
        );
        if (col) {
          cells.push({ row_id: itemId, column_id: col.id, date: [params.dueDate] });
        }
      }

      if (params.completed !== undefined && params.completed !== null) {
        const col = schema.columns.find(
          (c) => c.type === 'todo_completed' || c.type === 'completed' || c.key === 'completed',
        );
        if (col) {
          cells.push({ row_id: itemId, column_id: col.id, checkbox: params.completed });
        }
      }

      if (cells.length === 0) {
        throw new Error(
          'Nothing to update — provide status, title, assigneeUserId, dueDate, or completed',
        );
      }

      await slackApiPostJson(token, 'slackLists.items.update', {
        list_id: resolved.listId,
        cells,
      });
      await saveSlackFocus({
        agentId: params.agentId,
        runId: params.runId,
        focus: {
          channel: params.channel ?? resolved.channelId ?? resolved.listId,
          channelId: resolved.channelId,
          listId: resolved.listId,
          listTitle: schema.title ?? resolved.listTitle,
          itemId,
          taskTitle: params.title ?? params.taskTitle ?? null,
          status: params.status ?? null,
        },
      });
      return {
        ok: true,
        listId: resolved.listId,
        channel: params.channel ?? null,
        itemId,
        taskTitle: params.taskTitle ?? null,
        updatedFields: cells.length,
      };
    },
  });
}

export async function executeSlackDeleteListItem(params: {
  agentId: string;
  runId?: string | null;
  listId?: string | null;
  channel?: string | null;
  listTitle?: string | null;
  itemId?: string | null;
  taskTitle?: string | null;
  jitToken?: string | null;
}) {
  return runSlackTool({
    agentId: params.agentId,
    runId: params.runId ?? null,
    tool: 'slack_delete_list_item',
    requiredScope: 'slack.send',
    jitScope: 'slack.send',
    jitToken: params.jitToken,
    riskLevel: 'high',
    payload: {
      listId: params.listId ?? null,
      channel: params.channel ?? null,
      listTitle: params.listTitle ?? null,
      itemId: params.itemId ?? null,
      taskTitle: params.taskTitle ?? null,
    },
    execute: async (session) => {
      const token = session.credentials.accessToken;
      const resolved = await resolveSlackListIdForChannel({
        token,
        channel: params.channel,
        listId: params.listId,
        listTitle: params.listTitle,
      });
      const itemId = await resolveSlackListItemId({
        token,
        listId: resolved.listId,
        itemId: params.itemId,
        taskTitle: params.taskTitle,
      });
      await slackApiPostJson(token, 'slackLists.items.delete', {
        list_id: resolved.listId,
        id: itemId,
      });
      await saveSlackFocus({
        agentId: params.agentId,
        runId: params.runId,
        focus: {
          channel: params.channel ?? resolved.channelId ?? resolved.listId,
          channelId: resolved.channelId,
          listId: resolved.listId,
          listTitle: resolved.listTitle,
          taskTitle: null,
          itemId: null,
        },
      });
      return {
        ok: true,
        listId: resolved.listId,
        channel: params.channel ?? null,
        itemId,
        taskTitle: params.taskTitle ?? null,
        deleted: true,
      };
    },
  });
}

export async function executeSlackSetListTaskCompletion(params: {
  agentId: string;
  runId?: string | null;
  listId?: string | null;
  channel?: string | null;
  listTitle?: string | null;
  itemId?: string | null;
  taskTitle?: string | null;
  completed: boolean;
  jitToken?: string | null;
}) {
  return executeSlackUpdateListItem({
    ...params,
    completed: params.completed,
  });
}

export { slackConnectorNotConnectedMessage };
