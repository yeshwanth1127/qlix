import { decryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import { ConnectorsRepository } from './connectors.repository.js';
import { googleTokenCanComposeDrafts, refreshGoogleAccessToken } from './googleOAuth.service.js';
import { googleServiceConnected } from './googleServices.js';
import {
  gmailCreateDraft,
  gmailDeleteDraft,
  gmailDownloadAttachment,
  gmailList,
  gmailListDrafts,
  gmailSend,
  type GmailAttachmentMeta,
  type GmailFetchedMessage,
} from './gmailApi.service.js';
import type {
  EmailAttachmentProcessed,
  EmailReadInput,
  EmailReadResult,
  EmailSendInput,
  EmailSendResult,
} from './connectors.types.js';
import {
  GMAIL_RECONNECT_FOR_DRAFT_INSTRUCTIONS,
  gmailComposeScopeMissingMessage,
  gmailConnectorNotConnectedMessage,
} from './connectorUserMessages.js';
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
import { extractTextFromUpload } from '../aiBrain/brainExtractText.js';
import { storeSandboxFile } from '../sandbox/sandboxClient.js';

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

export class EmailComposeScopeMissingError extends Error {
  readonly code = 'gmail_compose_scope_missing';
  readonly connectInstructions = GMAIL_RECONNECT_FOR_DRAFT_INSTRUCTIONS;
  constructor(message = gmailComposeScopeMissingMessage()) {
    super(message);
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

/** Same caps spirit as chat uploads — keep email_read tool results bounded. */
const EMAIL_ATTACHMENT_MAX_PER_MESSAGE = 5;
const EMAIL_ATTACHMENT_MAX_PER_READ = 8;
const EMAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const EMAIL_ATTACHMENT_EXTRACT_CHARS = 80_000;

async function processOneEmailAttachment(params: {
  accessToken: string;
  messageId: string;
  meta: GmailAttachmentMeta;
}): Promise<EmailAttachmentProcessed> {
  const { meta } = params;
  if (meta.sizeBytes > EMAIL_ATTACHMENT_MAX_BYTES) {
    return {
      attachmentId: meta.attachmentId,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      url: '',
      error: `Attachment too large (max ${EMAIL_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB)`,
    };
  }
  try {
    const bytes = await gmailDownloadAttachment({
      accessToken: params.accessToken,
      messageId: params.messageId,
      attachmentId: meta.attachmentId,
    });
    if (bytes.length > EMAIL_ATTACHMENT_MAX_BYTES) {
      return {
        attachmentId: meta.attachmentId,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: bytes.length,
        url: '',
        error: `Attachment too large after download (max ${EMAIL_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB)`,
      };
    }
    const stored = await storeSandboxFile(bytes, meta.fileName, meta.mimeType);
    let extractedText: string | undefined;
    try {
      const raw = await extractTextFromUpload(bytes, meta.fileName);
      if (raw.trim()) {
        extractedText =
          raw.length > EMAIL_ATTACHMENT_EXTRACT_CHARS
            ? `${raw.slice(0, EMAIL_ATTACHMENT_EXTRACT_CHARS)}\n\n[…truncated]`
            : raw;
      }
    } catch {
      // Binary / unsupported — URL-only is fine (same as chat uploads).
    }
    return {
      attachmentId: meta.attachmentId,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      sizeBytes: bytes.length || meta.sizeBytes,
      url: stored.url,
      ...(extractedText
        ? { extractedText, textPreview: extractedText.slice(0, 500) }
        : meta.mimeType.startsWith('image/')
          ? {}
          : {}),
    };
  } catch (err) {
    return {
      attachmentId: meta.attachmentId,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      url: '',
      error: String((err as Error)?.message ?? err).slice(0, 300),
    };
  }
}

async function enrichMessagesWithAttachments(params: {
  accessToken: string;
  messages: GmailFetchedMessage[];
  includeAttachments: boolean;
}): Promise<EmailReadResult['messages']> {
  if (!params.includeAttachments) {
    return params.messages.map(({ _attachmentMetas: _drop, ...msg }) => msg);
  }

  let remaining = EMAIL_ATTACHMENT_MAX_PER_READ;
  const out: EmailReadResult['messages'] = [];

  for (const msg of params.messages) {
    const metas = (msg._attachmentMetas ?? []).slice(0, EMAIL_ATTACHMENT_MAX_PER_MESSAGE);
    const { _attachmentMetas: _drop, ...base } = msg;
    if (metas.length === 0 || remaining <= 0) {
      out.push(metas.length > 0 && remaining <= 0
        ? {
            ...base,
            attachments: metas.map((m) => ({
              attachmentId: m.attachmentId,
              fileName: m.fileName,
              mimeType: m.mimeType,
              sizeBytes: m.sizeBytes,
              url: '',
              error: 'Skipped: attachment budget for this email_read exceeded',
            })),
          }
        : base);
      continue;
    }
    const take = metas.slice(0, remaining);
    remaining -= take.length;
    const attachments = await Promise.all(
      take.map((meta) =>
        processOneEmailAttachment({
          accessToken: params.accessToken,
          messageId: msg.id,
          meta,
        }),
      ),
    );
    // Any metas beyond budget on this message.
    const skipped = metas.slice(take.length).map((m) => ({
      attachmentId: m.attachmentId,
      fileName: m.fileName,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      url: '',
      error: 'Skipped: attachment budget for this email_read exceeded',
    }));
    out.push({ ...base, attachments: [...attachments, ...skipped] });
  }
  return out;
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
  const includeAttachments = params.input.includeAttachments !== false;

  try {
    let messages: EmailReadResult['messages'];
    if (useN8n) {
      const path = settings!.n8nEmailReadPath ?? '/webhook/qlix-email-read';
      const result = await callN8nWebhook({
        orgId: ctx.orgId,
        path,
        body: { accessToken, query, maxResults, messageId },
      });
      // Legacy n8n webhooks do not download attachments into the sandbox.
      messages = (Array.isArray(result.messages) ? result.messages : []) as EmailReadResult['messages'];
    } else {
      const listed = await gmailList({ accessToken, query, maxResults, messageId });
      messages = await enrichMessagesWithAttachments({
        accessToken,
        messages: listed.messages,
        includeAttachments,
      });
    }
    const attachmentCount = messages.reduce((n, m) => n + (m.attachments?.length ?? 0), 0);
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.read',
      status: 'success',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: {
        query,
        messageId,
        resultCount: messages.length,
        attachmentCount,
        includeAttachments,
        via: useN8n ? 'n8n' : 'gmail_api',
      },
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

  const modeRaw = params.input.mode ?? 'send';
  const mode: EmailSendInput['mode'] =
    modeRaw === 'draft' || modeRaw === 'list_drafts' || modeRaw === 'delete_draft'
      ? modeRaw
      : 'send';
  const isDraft = mode === 'draft';
  const isListDrafts = mode === 'list_drafts';
  const isDeleteDraft = mode === 'delete_draft';
  const needsCompose = isDraft || isListDrafts || isDeleteDraft;

  if (isDeleteDraft) {
    const draftId = params.input.draftId?.trim() ?? '';
    if (!draftId) throw new EmailToolError('email_send mode=delete_draft requires draftId');
  }

  if (mode === 'send' && params.input.to.length === 0) {
    throw new EmailToolError('email_send mode=send requires at least one recipient');
  }
  if ((mode === 'send' || isDraft) && !params.input.subject.trim()) {
    throw new EmailToolError(`email_send mode=${mode} requires subject`);
  }
  if ((mode === 'send' || isDraft) && !params.input.bodyText.trim()) {
    throw new EmailToolError(`email_send mode=${mode} requires bodyText`);
  }

  if (mode === 'send' || isDraft) {
    for (const to of params.input.to) {
      if (isPlaceholderEmail(to)) {
        throw new EmailToolError(
          `Refusing to ${isDraft ? 'draft to' : 'send to'} fake/placeholder address "${to}". This is not a real business email. ` +
            `Do NOT invent addresses like info@cafe1.com. First run mcp.qlix-leads.gmb_search_leads, ` +
            `then mcp.qlix-leads.list_leads, and use ONLY the verified emails it returns.`,
        );
      }
    }

    // A whole batch of sequential invented recipients (info@cafe1.com, info@cafe2.com, …)
    // is the classic signature of an agent skipping the scrape/list step. Refuse it outright.
    if (params.input.to.length > 0 && isFabricatedRecipientBatch(params.input.to)) {
      throw new EmailToolError(
        `Refusing to ${isDraft ? 'draft' : 'send'}: the recipient list looks fabricated (sequential invented domains). ` +
          'Scrape real leads with mcp.qlix-leads.gmb_search_leads and use the verified emails from list_leads.',
      );
    }
  }

  // Lead-gen enforcement applies to real sends only — drafts may be prepared before outreach.
  if (mode === 'send' && (await agentDoesLeadOutreach(params.agentId, ctx))) {
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

  // Draft list/create/delete never leave the mailbox — skip JIT. Sends keep approval.
  if (mode === 'send') {
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
  }

  const tokens = await repo.loadTokens(ctx.orgId, 'google');
  if (!tokens) throw new ConnectorNotConfiguredError(gmailConnectorNotConnectedMessage());
  if (needsCompose && !googleTokenCanComposeDrafts(tokens.scopes ?? [])) {
    throw new EmailComposeScopeMissingError();
  }

  const accessToken = await getFreshAccessToken(ctx.orgId);
  const mailboxEmail =
    tokens.emailAddress?.trim() ||
    (await repo.findByOrgProvider(ctx.orgId, 'google'))?.emailAddress?.trim() ||
    null;
  const settings = await repo.getN8nSettings(ctx.orgId);
  // In-house Gmail API is the default; n8n only when an org explicitly configured it.
  // Draft ops always use the Gmail API (n8n send webhooks do not manage drafts).
  const useN8n = mode === 'send' && Boolean(settings?.n8nBaseUrl && settings?.n8nWebhookSecretEnc);
  const riskLevel = mode === 'send' ? 'high' : 'medium';

  const withMailbox = (result: EmailSendResult): EmailSendResult => {
    const base: EmailSendResult = {
      ...result,
      ...(mailboxEmail ? { mailboxEmail } : {}),
    };
    if (result.mode === 'draft' || result.status === 'draft') {
      return {
        ...base,
        note:
          `Draft saved in Gmail Drafts for ${mailboxEmail ?? 'the connected Google account'}. ` +
          `It was NOT sent. Recipients in "to" only prefill the draft — they will not see it until someone clicks Send in Gmail.`,
      };
    }
    if (result.mode === 'send' || result.status === 'sent') {
      return {
        ...base,
        note: `Email delivered from ${mailboxEmail ?? 'the connected Google account'}.`,
      };
    }
    if (result.mode === 'list_drafts' || result.status === 'listed') {
      return {
        ...base,
        note: `Drafts listed from ${mailboxEmail ?? 'the connected Google account'}.`,
      };
    }
    return base;
  };

  try {
    let result: EmailSendResult;
    if (isListDrafts) {
      const listed = await gmailListDrafts({
        accessToken,
        maxResults: params.input.maxResults,
      });
      result = withMailbox({
        messageId: '',
        threadId: '',
        status: 'listed',
        mode: 'list_drafts',
        drafts: listed.drafts,
      });
    } else if (isDeleteDraft) {
      const deleted = await gmailDeleteDraft({
        accessToken,
        draftId: params.input.draftId!.trim(),
      });
      result = withMailbox({
        messageId: '',
        threadId: '',
        status: 'deleted',
        draftId: deleted.draftId,
        mode: 'delete_draft',
      });
    } else if (isDraft) {
      const draft = await gmailCreateDraft({
        accessToken,
        to: params.input.to,
        subject: params.input.subject,
        bodyText: params.input.bodyText,
        replyToMessageId: params.input.replyToMessageId ?? null,
      });
      result = withMailbox({
        messageId: draft.messageId,
        threadId: draft.threadId,
        status: 'draft',
        draftId: draft.draftId,
        mode: 'draft',
      });
    } else if (useN8n) {
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
      result = withMailbox({
        messageId: String(raw.messageId ?? ''),
        threadId: String(raw.threadId ?? ''),
        status: String(raw.status ?? 'sent'),
        mode: 'send',
      });
    } else {
      const sent = await gmailSend({
        accessToken,
        to: params.input.to,
        subject: params.input.subject,
        bodyText: params.input.bodyText,
        replyToMessageId: params.input.replyToMessageId ?? null,
      });
      result = withMailbox({ ...sent, mode: 'send' });
    }
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.send',
      status: 'success',
      riskLevel,
      teamRunId: ctx.teamRunId,
      payload: {
        mode,
        recipientDomains: recipientDomains(params.input.to),
        recipientCount: params.input.to.length,
        subjectPreview: params.input.subject.slice(0, 120) || null,
        messageId: result.messageId || null,
        draftId: result.draftId ?? null,
        draftCount: result.drafts?.length ?? null,
        mailboxEmail,
        via: useN8n ? 'n8n' : 'gmail_api',
        campaignId: params.input.metadata?.campaignId ?? null,
        leadId: params.input.metadata?.leadId ?? null,
      },
    });
    if (mode === 'send' && params.input.metadata?.campaignId && params.input.metadata?.leadId) {
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
    if (err instanceof EmailComposeScopeMissingError) throw err;
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.send',
      status: 'failed',
      riskLevel,
      teamRunId: ctx.teamRunId,
      payload: { mode, error: String((err as Error)?.message ?? err), mailboxEmail },
    });
    throw err instanceof EmailToolError ? err : new EmailToolError(String((err as Error)?.message ?? err));
  }
}

export async function hasEmailConnector(orgId: string): Promise<boolean> {
  const account = await repo.findByOrgProvider(orgId, 'google');
  if (account?.status !== 'connected') return false;
  return googleServiceConnected('gmail', account.scopes);
}
