import { decryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import { ConnectorsRepository } from './connectors.repository.js';
import { refreshGoogleAccessToken } from './googleOAuth.service.js';
import { gmailList, gmailSend } from './gmailApi.service.js';
import type { EmailReadInput, EmailReadResult, EmailSendInput, EmailSendResult } from './connectors.types.js';
import { gmailConnectorNotConnectedMessage } from './connectorUserMessages.js';
import { isPlaceholderEmail, isFabricatedRecipientBatch } from '../leads/leadEmailTrust.js';
import {
  hasListedLeadsRecently,
  hasListedLeadsRecentlyForTeamRun,
  isCampaignOutreachApproved,
} from '../leads/leadOutreachGate.js';
import { LeadsService, LeadEnrichmentRequiredError } from '../leads/leads.service.js';
import { McpRepository } from '../mcp/mcp.repository.js';
import { safeFetch } from '../mcp/ssrfGuard.js';
import { JitService } from '../jit/jit.service.js';

const jitService = new JitService();
const mcpRepo = new McpRepository();

/**
 * True when this agent is wired for lead outreach: bound to the qlix-leads MCP server
 * or holding any mcp.qlix-leads.* scope. Such agents must only email verified scraped
 * leads, so we can safely reject any recipient that isn't in the lead DB.
 */
async function agentDoesLeadOutreach(
  agentId: string,
  ctx: { permissionScopes: string[]; alwaysScopes: string[] },
): Promise<boolean> {
  const hasLeadScope = [...ctx.permissionScopes, ...ctx.alwaysScopes].some((s) =>
    s.startsWith('mcp.qlix-leads.'),
  );
  if (hasLeadScope) return true;
  try {
    const bindings = await mcpRepo.listBindingsForAgent(agentId);
    return bindings.some((b) => b.serverSlug === 'qlix-leads');
  } catch {
    return false;
  }
}

export class ConnectorNotConfiguredError extends Error {
  readonly code = 'connector_not_configured';
}

export class N8nNotConfiguredError extends Error {
  readonly code = 'n8n_not_configured';
}

export class EmailScopeDeniedError extends Error {
  readonly code = 'scope_denied';
  constructor(scope: string) {
    super(`Agent lacks effective scope: ${scope}`);
  }
}

export class EmailToolError extends Error {
  readonly code = 'email_tool_failed';
}

const repo = new ConnectorsRepository();
const actionsService = new ActionsService();
const leadsService = new LeadsService();

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

async function loadAgentRunContext(agentId: string, runId: string | null): Promise<{
  runSkills: string[];
  teamRunId: string | null;
  userId: string;
  orgId: string | null;
  permissionScopes: string[];
  alwaysScopes: string[];
  jitScopes: string[];
}> {
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
  if (!agent) throw new EmailToolError('Agent not found');

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

  // Guest/chat-created agents have `agent.orgId = null` even though the owning user
  // always belongs to a workspace org (every User.orgId is non-null). Connector tokens
  // are keyed on that same user org (auth.orgId at connect time), so fall back to it —
  // this lets guest agents use the connector without inventing a throwaway org.
  const resolvedOrgId = agent.orgId ?? agent.user.orgId;

  return {
    runSkills,
    teamRunId,
    userId: agent.userId,
    orgId: resolvedOrgId,
    permissionScopes: agent.permissionScopes as string[],
    alwaysScopes: agent.alwaysScopes as string[],
    jitScopes: agent.jitScopes as string[],
  };
}

async function getFreshAccessToken(orgId: string): Promise<string> {
  const tokens = await repo.loadTokens(orgId, 'google');
  if (!tokens) throw new ConnectorNotConfiguredError(gmailConnectorNotConnectedMessage());

  const bufferMs = 60_000;
  if (tokens.expiresAtMs && tokens.expiresAtMs - Date.now() > bufferMs) {
    return tokens.accessToken;
  }

  const refreshed = await refreshGoogleAccessToken(tokens.refreshToken);
  const updated = {
    ...tokens,
    accessToken: refreshed.accessToken,
    expiresAtMs: refreshed.expiresAtMs,
  };
  await repo.saveTokens(orgId, 'google', updated);
  return refreshed.accessToken;
}

async function callN8nWebhook(params: {
  orgId: string;
  path: string;
  body: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const settings = await repo.getN8nSettings(params.orgId);
  if (!settings?.n8nBaseUrl || !settings.n8nWebhookSecretEnc) {
    throw new N8nNotConfiguredError('n8n integration not configured for this organization');
  }
  const secret = decryptForAgentSecrets(settings.n8nWebhookSecretEnc);
  const url = `${settings.n8nBaseUrl.replace(/\/$/, '')}${params.path.startsWith('/') ? params.path : `/${params.path}`}`;

  const resp = await safeFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(params.body),
  });
  const text = await resp.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text.slice(0, 4000) };
  }
  if (!resp.ok) {
    throw new EmailToolError(`n8n webhook failed (${resp.status}): ${text.slice(0, 500)}`);
  }
  return parsed;
}

function recipientDomains(to: string[]): string[] {
  return [...new Set(to.map((addr) => addr.split('@')[1]?.toLowerCase()).filter(Boolean))];
}

export async function executeEmailRead(params: {
  agentId: string;
  runId: string | null;
  input: EmailReadInput;
}): Promise<EmailReadResult> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveScopes(ctx);
  if (!scopes.has('email.read')) throw new EmailScopeDeniedError('email.read');
  if (!ctx.orgId) throw new ConnectorNotConfiguredError('Agent must belong to an organization');

  const accessToken = await getFreshAccessToken(ctx.orgId);
  const settings = await repo.getN8nSettings(ctx.orgId);
  // In-house Gmail API is the default; n8n is only used when an org explicitly
  // configured it (backward compat), keeping existing webhook setups working.
  const useN8n = Boolean(settings?.n8nBaseUrl && settings?.n8nWebhookSecretEnc);
  const query = params.input.query ?? 'is:unread';
  const maxResults = Math.min(Math.max(params.input.maxResults ?? 10, 1), 25);
  const messageId = params.input.messageId ?? null;

  try {
    let messages: EmailReadResult['messages'];
    if (useN8n) {
      const path = settings!.n8nEmailReadPath ?? '/webhook/qlix-email-read';
      const result = await callN8nWebhook({
        orgId: ctx.orgId,
        path,
        body: { accessToken, query, maxResults, messageId },
      });
      messages = (Array.isArray(result.messages) ? result.messages : []) as EmailReadResult['messages'];
    } else {
      ({ messages } = await gmailList({ accessToken, query, maxResults, messageId }));
    }
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.read',
      status: 'success',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: { query, messageId, resultCount: messages.length, via: useN8n ? 'n8n' : 'gmail_api' },
    });
    return { messages };
  } catch (err) {
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.read',
      status: 'failed',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: { error: String((err as Error)?.message ?? err) },
    });
    throw err instanceof EmailToolError ? err : new EmailToolError(String((err as Error)?.message ?? err));
  }
}

export async function executeEmailSend(params: {
  agentId: string;
  runId: string | null;
  input: EmailSendInput;
}): Promise<EmailSendResult> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveScopes(ctx);
  if (!scopes.has('email.send')) throw new EmailScopeDeniedError('email.send');
  if (!ctx.orgId) throw new ConnectorNotConfiguredError(gmailConnectorNotConnectedMessage());

  for (const to of params.input.to) {
    if (isPlaceholderEmail(to)) {
      throw new EmailToolError(
        `Refusing to send to fake/placeholder address "${to}". This is not a real business email. ` +
          `Do NOT invent addresses like info@cafe1.com. First run mcp.qlix-leads.gmb_search_leads, ` +
          `then mcp.qlix-leads.list_leads, and send ONLY to the verified emails it returns.`,
      );
    }
  }

  // A whole batch of sequential invented recipients (info@cafe1.com, info@cafe2.com, …)
  // is the classic signature of an agent skipping the scrape/list step. Refuse it outright.
  if (isFabricatedRecipientBatch(params.input.to)) {
    throw new EmailToolError(
      'Refusing to send: the recipient list looks fabricated (sequential invented domains). ' +
        'Scrape real leads with mcp.qlix-leads.gmb_search_leads and use the verified emails from list_leads.',
    );
  }

  // Lead-gen enforcement: an agent wired for lead outreach must follow the UX order
  // scrape -> list leads to the user -> send. Two structural checks:
  //   1. leads must have been listed/scraped in this working session (present-first)
  //   2. every recipient must exist as a verified scraped lead (no hallucinated emails)
  if (await agentDoesLeadOutreach(params.agentId, ctx)) {
    const listed =
      (await hasListedLeadsRecently(params.agentId)) ||
      (ctx.teamRunId != null && (await hasListedLeadsRecentlyForTeamRun(ctx.teamRunId)));
    if (!listed) {
      throw new EmailToolError(
        'Refusing to send: you must scrape and present the leads to the user before any outreach. ' +
          'First call mcp.qlix-leads.gmb_search_leads, then mcp.qlix-leads.list_leads, show the ' +
          'resulting business names and emails to the user, and only send after that step.',
      );
    }
    const campaignId =
      (params.input.metadata?.campaignId as string | undefined)?.trim() ||
      (await leadsService.resolveCampaignIdFromRecipients(ctx.orgId, params.input.to));
    // Skip the campaign-wide enrichment-complete block when the user already reviewed
    // this campaign's leads in the UI and approved outreach — they saw which leads
    // still lack emails. Per-recipient verified-email checks below still apply.
    if (campaignId && !(await isCampaignOutreachApproved(campaignId))) {
      try {
        await leadsService.assertBrowserEnrichmentComplete(ctx.orgId, campaignId);
      } catch (err) {
        if (err instanceof LeadEnrichmentRequiredError) {
          throw new EmailToolError(err.message);
        }
        throw err;
      }
    }
    for (const to of params.input.to) {
      const isRealLead = await leadsService.isVerifiedLeadRecipient(ctx.orgId, to);
      if (!isRealLead) {
        throw new EmailToolError(
          `Refusing to send to "${to}" — it is not a verified lead for this workspace. ` +
            `Only send to emails returned by mcp.qlix-leads.list_leads after scraping. ` +
            `If you have no leads yet, run mcp.qlix-leads.gmb_search_leads first.`,
        );
      }
    }
  }

  // QLIX_JIT_AUTO_APPROVE bypasses approval in dev. Cloud email runtime requests JIT via
  // /api/v1/jit/request before send; first approval in chat UI creates a conversation grant.
  const jitAutoApprove =
    process.env.QLIX_JIT_AUTO_APPROVE === '1' || process.env.QLIX_JIT_AUTO_APPROVE === 'true';
  const needsJit =
    !jitAutoApprove &&
    (ctx.jitScopes as PermissionScope[]).includes('email.send') &&
    !(ctx.alwaysScopes as PermissionScope[]).includes('email.send');

  if (needsJit) {
    const token = params.input.jitToken?.trim();
    if (!token) {
      const sessionGranted = await jitService.hasActiveConversationGrantForRun(
        params.runId,
        'email.send',
      );
      if (!sessionGranted) {
        throw new JitTokenRequiredError('email.send requires dashboard approval');
      }
      await jitService.touchConversationGrantForRun(params.runId, 'email.send');
    } else {
      const ok = await actionsService.consumeJitToken({
        agentId: params.agentId,
        actionType: 'email.send',
        token,
      });
      if (!ok) throw new JitTokenInvalidError('Invalid or already used jitToken for email.send');
    }
  }

  const accessToken = await getFreshAccessToken(ctx.orgId);
  const settings = await repo.getN8nSettings(ctx.orgId);
  // In-house Gmail API is the default; n8n only when an org explicitly configured it.
  const useN8n = Boolean(settings?.n8nBaseUrl && settings?.n8nWebhookSecretEnc);

  try {
    let result: EmailSendResult;
    if (useN8n) {
      const path = settings!.n8nEmailSendPath ?? '/webhook/qlix-email-send';
      const raw = await callN8nWebhook({
        orgId: ctx.orgId,
        path,
        body: {
          accessToken,
          to: params.input.to,
          subject: params.input.subject,
          bodyText: params.input.bodyText,
          replyToMessageId: params.input.replyToMessageId ?? null,
        },
      });
      result = {
        messageId: String(raw.messageId ?? ''),
        threadId: String(raw.threadId ?? ''),
        status: String(raw.status ?? 'sent'),
      };
    } else {
      result = await gmailSend({
        accessToken,
        to: params.input.to,
        subject: params.input.subject,
        bodyText: params.input.bodyText,
        replyToMessageId: params.input.replyToMessageId ?? null,
      });
    }
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.send',
      status: 'success',
      riskLevel: 'high',
      teamRunId: ctx.teamRunId,
      payload: {
        recipientDomains: recipientDomains(params.input.to),
        recipientCount: params.input.to.length,
        subjectPreview: params.input.subject.slice(0, 120),
        messageId: result.messageId || null,
        via: useN8n ? 'n8n' : 'gmail_api',
        campaignId: params.input.metadata?.campaignId ?? null,
        leadId: params.input.metadata?.leadId ?? null,
      },
    });
    if (params.input.metadata?.campaignId && params.input.metadata?.leadId) {
      await leadsService.recordOutreachFromEmail({
        campaignId: params.input.metadata.campaignId,
        leadId: params.input.metadata.leadId,
        channel: 'email',
        provider: useN8n ? 'n8n' : 'gmail',
        status: 'sent',
        subject: params.input.subject,
        bodyPreview: params.input.bodyText.slice(0, 200),
      }).catch(() => undefined);
    }
    return result;
  } catch (err) {
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.send',
      status: 'failed',
      riskLevel: 'high',
      teamRunId: ctx.teamRunId,
      payload: { error: String((err as Error)?.message ?? err) },
    });
    throw err instanceof EmailToolError ? err : new EmailToolError(String((err as Error)?.message ?? err));
  }
}

export async function hasEmailConnector(orgId: string): Promise<boolean> {
  const account = await repo.findByOrgProvider(orgId, 'google');
  return account?.status === 'connected';
}
