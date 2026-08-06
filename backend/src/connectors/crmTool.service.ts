import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import { CRM_CONNECT_INSTRUCTIONS, crmConnectorNotConnectedMessage } from './connectorUserMessages.js';
import { ConnectorNotConfiguredError } from './emailTool.service.js';
import { JitService } from '../jit/jit.service.js';
import { persistCrmSession, refreshCrmSession, resolveCrmSession } from './crm/crmConnector.service.js';
import { getCrmAdapter } from './crm/crmRegistry.js';
import type { CrmSession, CrmToolResult } from './crm/crm.types.js';

export { CRM_CONNECT_INSTRUCTIONS };

export class CrmScopeDeniedError extends Error {
  readonly code = 'scope_denied';
  constructor(scope: string) {
    super(`Agent lacks effective scope: ${scope}`);
  }
}

export class CrmToolError extends Error {
  readonly code = 'crm_tool_failed';
}

type CrmActionType = 'crm.read' | 'crm.write' | 'crm.delete';

const actionsService = new ActionsService();
const jitService = new JitService();

const JIT_SCOPES: Record<CrmActionType, PermissionScope | null> = {
  'crm.read': null,
  'crm.write': 'crm.write',
  'crm.delete': 'crm.delete',
};

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
  if (!agent) throw new CrmToolError('Agent not found');

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

async function assertCrmJit(params: {
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
      throw new JitTokenRequiredError(`${params.jitScope} requires approval in chat — Approve the pending request in this conversation`);
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

async function runCrmTool<T>(params: {
  agentId: string;
  runId: string | null;
  tool: string;
  requiredScope: PermissionScope;
  actionType: CrmActionType;
  jitScope?: PermissionScope;
  jitToken?: string | null;
  riskLevel: 'low' | 'medium' | 'high';
  payload: Record<string, unknown>;
  execute: (session: CrmSession) => Promise<CrmToolResult<T>>;
}): Promise<T> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveScopes(ctx);
  if (!scopes.has(params.requiredScope)) {
    throw new CrmScopeDeniedError(params.requiredScope);
  }

  if (params.jitScope) {
    await assertCrmJit({
      agentId: params.agentId,
      runId: params.runId,
      ctx,
      jitScope: params.jitScope,
      jitToken: params.jitToken,
    });
  }

  let session = await resolveCrmSession(ctx.orgId);
  session = await refreshCrmSession(session);

  try {
    const result = await params.execute(session);
    await persistCrmSession(result.session);
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: params.actionType,
      payload: {
        tool: params.tool,
        platform: session.platform,
        ...params.payload,
      },
      status: 'success',
      riskLevel: params.riskLevel,
      teamRunId: ctx.teamRunId,
    });
    return result.data;
  } catch (err) {
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: params.actionType,
      payload: {
        tool: params.tool,
        platform: session.platform,
        error: String(err),
        ...params.payload,
      },
      status: 'failed',
      riskLevel: params.riskLevel,
      teamRunId: ctx.teamRunId,
    });
    if (err instanceof ConnectorNotConfiguredError) throw err;
    throw err instanceof Error ? err : new CrmToolError(String(err));
  }
}

export async function executeCrmListModules(params: {
  agentId: string;
  runId: string | null;
}): Promise<{ platform: string; modules: unknown[]; queryLanguage: string; queryHint: string }> {
  let platform = 'unknown';
  let queryLanguage = '';
  let queryHint = '';
  const modules = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_list_modules',
    requiredScope: 'crm.read',
    actionType: 'crm.read',
    riskLevel: 'low',
    payload: {},
    execute: async (session) => {
      const adapter = getCrmAdapter(session.platform);
      platform = adapter.platformId;
      queryLanguage = adapter.queryLanguage;
      queryHint = adapter.queryHint;
      return adapter.listModules(session);
    },
  });
  return { platform, modules, queryLanguage, queryHint };
}

export async function executeCrmDescribeModule(params: {
  agentId: string;
  runId: string | null;
  module: string;
}): Promise<unknown> {
  return runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_describe_module',
    requiredScope: 'crm.read',
    actionType: 'crm.read',
    riskLevel: 'low',
    payload: { module: params.module },
    execute: (session) => getCrmAdapter(session.platform).describeModule(session, params.module),
  });
}

export async function executeCrmQuery(params: {
  agentId: string;
  runId: string | null;
  query: string;
}): Promise<{ records: unknown[] }> {
  const records = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_query',
    requiredScope: 'crm.read',
    actionType: 'crm.read',
    riskLevel: 'low',
    payload: { query: params.query },
    execute: (session) => getCrmAdapter(session.platform).queryRecords(session, { query: params.query }),
  });
  return { records };
}

export async function executeCrmSearch(params: {
  agentId: string;
  runId: string | null;
  input: { module: string; word?: string; fields?: string[]; page?: number; perPage?: number };
}): Promise<{ records: unknown[] }> {
  const records = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_search',
    requiredScope: 'crm.read',
    actionType: 'crm.read',
    riskLevel: 'low',
    payload: { module: params.input.module, word: params.input.word ?? null },
    execute: (session) => getCrmAdapter(session.platform).searchRecords(session, params.input),
  });
  return { records };
}

export async function executeCrmGet(params: {
  agentId: string;
  runId: string | null;
  input: { module: string; recordId: string; fields?: string[] };
}): Promise<{ record: unknown | null }> {
  const record = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_get',
    requiredScope: 'crm.read',
    actionType: 'crm.read',
    riskLevel: 'low',
    payload: { module: params.input.module, recordId: params.input.recordId },
    execute: (session) => getCrmAdapter(session.platform).getRecord(session, params.input),
  });
  return { record };
}

export async function executeCrmCreate(params: {
  agentId: string;
  runId: string | null;
  input: { module: string; fields: Record<string, unknown>; jitToken?: string | null };
}): Promise<{ record: unknown | null }> {
  const record = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_create',
    requiredScope: 'crm.write',
    actionType: 'crm.write',
    jitScope: 'crm.write',
    jitToken: params.input.jitToken,
    riskLevel: 'medium',
    payload: { module: params.input.module },
    execute: (session) => getCrmAdapter(session.platform).createRecord(session, params.input),
  });
  return { record };
}

export async function executeCrmUpdate(params: {
  agentId: string;
  runId: string | null;
  input: { module: string; recordId: string; fields: Record<string, unknown>; jitToken?: string | null };
}): Promise<{ record: unknown | null }> {
  const record = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_update',
    requiredScope: 'crm.write',
    actionType: 'crm.write',
    jitScope: 'crm.write',
    jitToken: params.input.jitToken,
    riskLevel: 'medium',
    payload: { module: params.input.module, recordId: params.input.recordId },
    execute: (session) => getCrmAdapter(session.platform).updateRecord(session, params.input),
  });
  return { record };
}

export async function executeCrmDelete(params: {
  agentId: string;
  runId: string | null;
  input: { module: string; recordId: string; jitToken?: string | null };
}): Promise<{ deleted: boolean }> {
  return runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_delete',
    requiredScope: 'crm.delete',
    actionType: 'crm.delete',
    jitScope: 'crm.delete',
    jitToken: params.input.jitToken,
    riskLevel: 'high',
    payload: { module: params.input.module, recordId: params.input.recordId },
    execute: (session) => getCrmAdapter(session.platform).deleteRecord(session, params.input),
  });
}

export async function executeCrmBulkCreate(params: {
  agentId: string;
  runId: string | null;
  input: { module: string; records: Array<Record<string, unknown>>; jitToken?: string | null };
}): Promise<{ records: unknown[] }> {
  const records = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_bulk_create',
    requiredScope: 'crm.write',
    actionType: 'crm.write',
    jitScope: 'crm.write',
    jitToken: params.input.jitToken,
    riskLevel: 'medium',
    payload: { module: params.input.module, count: params.input.records.length },
    execute: (session) => getCrmAdapter(session.platform).bulkCreate(session, params.input),
  });
  return { records };
}

export async function executeCrmBulkUpdate(params: {
  agentId: string;
  runId: string | null;
  input: {
    module: string;
    records: Array<Record<string, unknown>>;
    recordIds?: string[];
    jitToken?: string | null;
  };
}): Promise<{ records: unknown[] }> {
  const records = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_bulk_update',
    requiredScope: 'crm.write',
    actionType: 'crm.write',
    jitScope: 'crm.write',
    jitToken: params.input.jitToken,
    riskLevel: 'medium',
    payload: { module: params.input.module, count: params.input.records.length },
    execute: (session) => getCrmAdapter(session.platform).bulkUpdate(session, params.input),
  });
  return { records };
}

export async function executeCrmConvertLead(params: {
  agentId: string;
  runId: string | null;
  input: {
    leadId: string;
    dealName?: string;
    accountName?: string;
    contactRole?: string;
    overwrite?: boolean;
    notifyLeadOwner?: boolean;
    assignTo?: string;
    jitToken?: string | null;
  };
}): Promise<{ result: unknown }> {
  const result = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_convert_lead',
    requiredScope: 'crm.write',
    actionType: 'crm.write',
    jitScope: 'crm.write',
    jitToken: params.input.jitToken,
    riskLevel: 'medium',
    payload: { leadId: params.input.leadId },
    execute: (session) => getCrmAdapter(session.platform).convertLead(session, params.input),
  });
  return { result };
}

export async function executeCrmLink(params: {
  agentId: string;
  runId: string | null;
  input: {
    module: string;
    recordId: string;
    relatedModule: string;
    relatedRecordId: string;
    jitToken?: string | null;
  };
}): Promise<{ linked: boolean }> {
  return runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_link',
    requiredScope: 'crm.write',
    actionType: 'crm.write',
    jitScope: 'crm.write',
    jitToken: params.input.jitToken,
    riskLevel: 'medium',
    payload: { ...params.input },
    execute: (session) => getCrmAdapter(session.platform).linkRecords(session, params.input),
  });
}

export async function executeCrmUnlink(params: {
  agentId: string;
  runId: string | null;
  input: {
    module: string;
    recordId: string;
    relatedModule: string;
    relatedRecordId: string;
    jitToken?: string | null;
  };
}): Promise<{ unlinked: boolean }> {
  return runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_unlink',
    requiredScope: 'crm.write',
    actionType: 'crm.write',
    jitScope: 'crm.write',
    jitToken: params.input.jitToken,
    riskLevel: 'medium',
    payload: { ...params.input },
    execute: (session) => getCrmAdapter(session.platform).unlinkRecords(session, params.input),
  });
}

export async function executeCrmListAttachments(params: {
  agentId: string;
  runId: string | null;
  input: { module: string; recordId: string };
}): Promise<{ attachments: unknown[] }> {
  const attachments = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_list_attachments',
    requiredScope: 'crm.read',
    actionType: 'crm.read',
    riskLevel: 'low',
    payload: { ...params.input },
    execute: (session) => getCrmAdapter(session.platform).listAttachments(session, params.input),
  });
  return { attachments };
}

export async function executeCrmUploadAttachment(params: {
  agentId: string;
  runId: string | null;
  input: {
    module: string;
    recordId: string;
    fileName: string;
    fileBase64: string;
    mimeType?: string;
    jitToken?: string | null;
  };
}): Promise<{ attachment: unknown | null }> {
  const attachment = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_upload_attachment',
    requiredScope: 'crm.write',
    actionType: 'crm.write',
    jitScope: 'crm.write',
    jitToken: params.input.jitToken,
    riskLevel: 'medium',
    payload: { module: params.input.module, recordId: params.input.recordId, fileName: params.input.fileName },
    execute: (session) => getCrmAdapter(session.platform).uploadAttachment(session, params.input),
  });
  return { attachment };
}

export async function executeCrmDownloadAttachment(params: {
  agentId: string;
  runId: string | null;
  input: { module: string; recordId: string; attachmentId: string };
}): Promise<{ fileName: string; mimeType: string; fileBase64: string }> {
  return runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_download_attachment',
    requiredScope: 'crm.read',
    actionType: 'crm.read',
    riskLevel: 'low',
    payload: { ...params.input },
    execute: (session) => getCrmAdapter(session.platform).downloadAttachment(session, params.input),
  });
}

export async function executeCrmAddNote(params: {
  agentId: string;
  runId: string | null;
  input: {
    module: string;
    recordId: string;
    title?: string;
    content: string;
    jitToken?: string | null;
  };
}): Promise<{ note: unknown | null }> {
  const note = await runCrmTool({
    agentId: params.agentId,
    runId: params.runId,
    tool: 'crm_add_note',
    requiredScope: 'crm.write',
    actionType: 'crm.write',
    jitScope: 'crm.write',
    jitToken: params.input.jitToken,
    riskLevel: 'low',
    payload: { module: params.input.module, recordId: params.input.recordId },
    execute: (session) => getCrmAdapter(session.platform).addNote(session, params.input),
  });
  return { note };
}

export function crmNotConnectedMessage(): string {
  return crmConnectorNotConnectedMessage();
}
