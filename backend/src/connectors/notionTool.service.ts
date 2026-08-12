import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import {
  NOTION_CONNECT_INSTRUCTIONS,
  notionConnectorNotConnectedMessage,
} from './connectorUserMessages.js';
import { ConnectorNotConfiguredError } from './emailTool.service.js';
import { JitService } from '../jit/jit.service.js';
import {
  NotionApiError,
  notionAppendPageContent,
  notionCreateDatabaseRow,
  notionCreatePage,
  notionGetPage,
  notionQueryDatabase,
  notionSearch,
} from './notionApi.service.js';
import { refreshNotionSession, resolveNotionSession, type NotionSession } from './notionConnector.service.js';

export { NOTION_CONNECT_INSTRUCTIONS, notionConnectorNotConnectedMessage };

export class NotionScopeDeniedError extends Error {
  readonly code = 'scope_denied';
  constructor(scope: string) {
    super(`Agent lacks effective scope: ${scope}`);
  }
}

export class NotionToolError extends Error {
  readonly code = 'notion_tool_failed';
}

export type NotionReadAction = 'search' | 'get_page' | 'query_database';
export type NotionWriteAction = 'create_page' | 'update_page' | 'create_database_row';

type NotionActionType = 'notion.read' | 'notion.write';

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
  if (!agent) throw new NotionToolError('Agent not found');

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
    permissionScopes: agent.permissionScopes as string[],
    alwaysScopes: agent.alwaysScopes as string[],
    jitScopes: agent.jitScopes as string[],
  };
}

async function assertNotionJit(params: {
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
    const sessionGranted = await jitService.hasActiveConversationGrantForRun(
      params.runId,
      params.jitScope,
    );
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

async function requireNotionSession(orgId: string | null): Promise<NotionSession> {
  let session = await resolveNotionSession(orgId);
  session = await refreshNotionSession(session);
  return session;
}

async function runNotionTool<T>(params: {
  agentId: string;
  runId: string | null;
  tool: string;
  requiredScope: NotionActionType;
  actionType: NotionActionType;
  jitScope?: NotionActionType;
  jitToken?: string | null;
  riskLevel: 'low' | 'medium' | 'high';
  payload: Record<string, unknown>;
  execute: (session: NotionSession) => Promise<T>;
}): Promise<T> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveScopes(ctx);
  if (!scopes.has(params.requiredScope)) {
    // Write scope also covers read (same convenience as drive.write covering drive.read tools elsewhere).
    if (!(params.requiredScope === 'notion.read' && scopes.has('notion.write'))) {
      throw new NotionScopeDeniedError(params.requiredScope);
    }
  }

  if (params.jitScope) {
    await assertNotionJit({
      agentId: params.agentId,
      runId: params.runId,
      ctx,
      jitScope: params.jitScope,
      jitToken: params.jitToken,
    });
  }

  const session = await requireNotionSession(ctx.orgId);

  try {
    const result = await params.execute(session);
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: params.actionType,
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
      actionType: params.actionType,
      payload: {
        tool: params.tool,
        error: String((err as Error)?.message ?? err),
        ...params.payload,
      },
      status: 'failed',
      riskLevel: params.riskLevel,
      teamRunId: ctx.teamRunId,
    });
    if (
      err instanceof ConnectorNotConfiguredError ||
      err instanceof NotionScopeDeniedError ||
      err instanceof NotionToolError ||
      err instanceof JitTokenRequiredError ||
      err instanceof JitTokenInvalidError
    ) {
      throw err;
    }
    throw new NotionToolError(
      err instanceof NotionApiError ? err.message : String((err as Error)?.message ?? err),
    );
  }
}

export async function executeNotionRead(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: NotionReadAction;
    query?: string;
    filter?: 'page' | 'database';
    pageId?: string;
    databaseId?: string;
    pageSize?: number;
    startCursor?: string | null;
    filterJson?: Record<string, unknown> | null;
    sorts?: unknown[] | null;
  };
}): Promise<Record<string, unknown>> {
  return runNotionTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'notion_read',
    requiredScope: 'notion.read',
    actionType: 'notion.read',
    riskLevel: 'low',
    payload: {
      action: params.input.action,
      pageId: params.input.pageId ?? null,
      databaseId: params.input.databaseId ?? null,
      query: params.input.query ?? null,
    },
    execute: async (session) => {
      const token = session.credentials.accessToken;
      if (params.input.action === 'search') {
        return notionSearch({
          accessToken: token,
          query: params.input.query,
          filter: params.input.filter,
          pageSize: params.input.pageSize,
          startCursor: params.input.startCursor,
        });
      }
      if (params.input.action === 'get_page') {
        if (!params.input.pageId?.trim()) {
          throw new NotionToolError('pageId is required for action=get_page');
        }
        return notionGetPage({ accessToken: token, pageId: params.input.pageId });
      }
      if (!params.input.databaseId?.trim()) {
        throw new NotionToolError('databaseId is required for action=query_database');
      }
      return notionQueryDatabase({
        accessToken: token,
        databaseId: params.input.databaseId,
        pageSize: params.input.pageSize,
        startCursor: params.input.startCursor,
        filter: params.input.filterJson ?? null,
        sorts: params.input.sorts ?? null,
      });
    },
  });
}

export async function executeNotionWrite(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: NotionWriteAction;
    pageId?: string;
    parentPageId?: string;
    parentDatabaseId?: string;
    databaseId?: string;
    title?: string;
    contentMarkdown?: string;
    properties?: Record<string, unknown>;
    jitToken?: string | null;
  };
}): Promise<Record<string, unknown>> {
  return runNotionTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'notion_write',
    requiredScope: 'notion.write',
    actionType: 'notion.write',
    jitScope: 'notion.write',
    jitToken: params.input.jitToken,
    riskLevel: 'high',
    payload: {
      action: params.input.action,
      pageId: params.input.pageId ?? null,
      parentPageId: params.input.parentPageId ?? null,
      parentDatabaseId: params.input.parentDatabaseId ?? params.input.databaseId ?? null,
      title: params.input.title ?? null,
    },
    execute: async (session) => {
      const token = session.credentials.accessToken;
      if (params.input.action === 'create_page') {
        if (!params.input.title?.trim()) {
          throw new NotionToolError('title is required for action=create_page');
        }
        if (!params.input.parentPageId?.trim() && !params.input.parentDatabaseId?.trim()) {
          throw new NotionToolError(
            'parentPageId or parentDatabaseId is required for action=create_page',
          );
        }
        return notionCreatePage({
          accessToken: token,
          parentPageId: params.input.parentPageId,
          parentDatabaseId: params.input.parentDatabaseId,
          title: params.input.title,
          contentMarkdown: params.input.contentMarkdown,
          properties: params.input.properties,
        });
      }
      if (params.input.action === 'update_page') {
        if (!params.input.pageId?.trim()) {
          throw new NotionToolError('pageId is required for action=update_page');
        }
        if (!params.input.contentMarkdown?.trim() && !params.input.title?.trim()) {
          throw new NotionToolError(
            'contentMarkdown or title is required for action=update_page',
          );
        }
        return notionAppendPageContent({
          accessToken: token,
          pageId: params.input.pageId,
          contentMarkdown: params.input.contentMarkdown?.trim() || '',
          title: params.input.title,
        });
      }
      const databaseId = params.input.databaseId?.trim() || params.input.parentDatabaseId?.trim();
      if (!databaseId) {
        throw new NotionToolError('databaseId is required for action=create_database_row');
      }
      return notionCreateDatabaseRow({
        accessToken: token,
        databaseId,
        title: params.input.title,
        properties: params.input.properties,
        contentMarkdown: params.input.contentMarkdown,
      });
    },
  });
}
