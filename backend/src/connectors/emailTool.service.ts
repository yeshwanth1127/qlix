import { decryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import { ConnectorsRepository } from './connectors.repository.js';
import { googleTokenCanComposeDrafts } from './googleOAuth.service.js';
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
  EmailProviderNotAvailableError,
  EmailProviderSelectionRequiredError,
  hasEmailConnector as hasResolvedEmailConnector,
  resolveEmailSession,
} from './emailConnector.service.js';
import {
  outlookCreateDraft,
  outlookDeleteDraft,
  outlookDownloadAttachment,
  outlookList,
  outlookListDrafts,
  outlookSend,
  type OutlookAttachmentMeta,
  type OutlookFetchedMessage,
} from './outlookApi.service.js';
import {
  GMAIL_RECONNECT_FOR_DRAFT_INSTRUCTIONS,
  gmailComposeScopeMissingMessage,
  gmailConnectorNotConnectedMessage,
} from './connectorUserMessages.js';
import { isPlaceholderEmail, isFabricatedRecipientBatch } from './emailSafety.js';
import { safeFetch } from '../mcp/ssrfGuard.js';
import { JitService } from '../jit/jit.service.js';
import { extractTextFromUpload } from '../aiBrain/brainExtractText.js';
import { storeSandboxFile } from '../sandbox/sandboxClient.js';

const jitService = new JitService();

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

async function enrichOutlookMessagesWithAttachments(params: {
  accessToken: string;
  messages: OutlookFetchedMessage[];
  includeAttachments: boolean;
}): Promise<EmailReadResult['messages']> {
  if (!params.includeAttachments) {
    return params.messages.map(({ _attachmentMetas: _drop, ...message }) => message);
  }
  let remaining = EMAIL_ATTACHMENT_MAX_PER_READ;
  const messages: EmailReadResult['messages'] = [];
  for (const message of params.messages) {
    const metas = (message._attachmentMetas ?? []).slice(0, EMAIL_ATTACHMENT_MAX_PER_MESSAGE);
    const { _attachmentMetas: _drop, ...base } = message;
    const selected = metas.slice(0, remaining);
    remaining -= selected.length;
    const attachments = await Promise.all(selected.map(async (meta: OutlookAttachmentMeta): Promise<EmailAttachmentProcessed> => {
      if (meta.sizeBytes > EMAIL_ATTACHMENT_MAX_BYTES) {
        return { ...meta, url: '', error: `Attachment too large (max ${EMAIL_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB)` };
      }
      try {
        const bytes = await outlookDownloadAttachment({
          accessToken: params.accessToken, messageId: message.id, attachmentId: meta.attachmentId,
        });
        if (bytes.length > EMAIL_ATTACHMENT_MAX_BYTES) {
          return { ...meta, sizeBytes: bytes.length, url: '', error: `Attachment too large after download (max ${EMAIL_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB)` };
        }
        const stored = await storeSandboxFile(bytes, meta.fileName, meta.mimeType);
        let extractedText: string | undefined;
        try {
          const raw = await extractTextFromUpload(bytes, meta.fileName);
          if (raw.trim()) extractedText = raw.length > EMAIL_ATTACHMENT_EXTRACT_CHARS ? `${raw.slice(0, EMAIL_ATTACHMENT_EXTRACT_CHARS)}\n\n[…truncated]` : raw;
        } catch { /* binary or unsupported attachment */ }
        return {
          ...meta, sizeBytes: bytes.length || meta.sizeBytes, url: stored.url,
          ...(extractedText ? { extractedText, textPreview: extractedText.slice(0, 500) } : {}),
        };
      } catch (err) {
        return { ...meta, url: '', error: String((err as Error)?.message ?? err).slice(0, 300) };
      }
    }));
    const skipped = metas.slice(selected.length).map((meta) => ({
      ...meta, url: '', error: 'Skipped: attachment budget for this email_read exceeded',
    }));
    messages.push({ ...base, ...(attachments.length || skipped.length ? { attachments: [...attachments, ...skipped] } : {}) });
  }
  return messages;
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

  const session = await resolveEmailSession({
    orgId: ctx.orgId,
    provider: params.input.provider,
    operation: 'read',
  });
  if (!session) throw new ConnectorNotConfiguredError('No Gmail or Microsoft 365 mailbox is connected for this workspace.');
  const accessToken = session.accessToken;
  const settings = await repo.getN8nSettings(ctx.orgId);
  // In-house Gmail API is the default; n8n is only used when an org explicitly
  // configured it (backward compat), keeping existing webhook setups working.
  const useN8n = session.provider === 'google' && Boolean(settings?.n8nBaseUrl && settings?.n8nWebhookSecretEnc);
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
    } else if (session.provider === 'google') {
      const listed = await gmailList({ accessToken, query, maxResults, messageId });
      messages = await enrichMessagesWithAttachments({
        accessToken,
        messages: listed.messages,
        includeAttachments,
      });
    } else {
      const listed = await outlookList({ accessToken, query, maxResults, messageId });
      messages = await enrichOutlookMessagesWithAttachments({
        accessToken, messages: listed.messages, includeAttachments,
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
        provider: session.provider,
        mailboxEmail: session.mailboxEmail,
        via: useN8n ? 'n8n' : session.provider === 'google' ? 'gmail_api' : 'graph_api',
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
    if (
      err instanceof EmailToolError ||
      err instanceof EmailProviderSelectionRequiredError ||
      err instanceof EmailProviderNotAvailableError
    ) throw err;
    throw new EmailToolError(String((err as Error)?.message ?? err));
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
          `Refusing to ${isDraft ? 'draft to' : 'send to'} fake/placeholder address "${to}". ` +
            'Do NOT invent addresses like info@cafe1.com — use only real addresses provided by the user or obtained from trusted tools.',
        );
      }
    }

    if (params.input.to.length > 0 && isFabricatedRecipientBatch(params.input.to)) {
      throw new EmailToolError(
        `Refusing to ${isDraft ? 'draft' : 'send'}: the recipient list looks fabricated (sequential invented domains). ` +
          'Use only real addresses provided by the user or obtained from trusted tools.',
      );
    }
  }

  // Resolve the mailbox before requesting send approval. When both providers are
  // connected this intentionally makes the model ask the user on every operation.
  const session = await resolveEmailSession({
    orgId: ctx.orgId,
    provider: params.input.provider,
    operation: mode === 'send' ? 'send' : 'draft',
  });
  if (!session) throw new ConnectorNotConfiguredError('No Gmail or Microsoft 365 mailbox is connected for this workspace.');

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

  if (session.provider === 'google' && needsCompose && !googleTokenCanComposeDrafts(session.tokens.scopes ?? [])) {
    throw new EmailComposeScopeMissingError();
  }

  const accessToken = session.accessToken;
  const mailboxEmail =
    session.mailboxEmail?.trim() ||
    (await repo.findByOrgProvider(ctx.orgId, session.provider))?.emailAddress?.trim() ||
    null;
  const settings = await repo.getN8nSettings(ctx.orgId);
  // In-house Gmail API is the default; n8n only when an org explicitly configured it.
  // Draft ops always use the Gmail API (n8n send webhooks do not manage drafts).
  const useN8n = session.provider === 'google' && mode === 'send' && Boolean(settings?.n8nBaseUrl && settings?.n8nWebhookSecretEnc);
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
          `Draft saved in the selected mailbox Drafts folder for ${mailboxEmail ?? 'the connected account'}. ` +
          `It was NOT sent. Recipients in "to" only prefill the draft — they will not see it until someone clicks Send.`,
      };
    }
    if (result.mode === 'send' || result.status === 'sent') {
      return {
        ...base,
        note: `Email delivered from ${mailboxEmail ?? 'the selected mailbox'}.`,
      };
    }
    if (result.mode === 'list_drafts' || result.status === 'listed') {
      return {
        ...base,
        note: `Drafts listed from ${mailboxEmail ?? 'the selected mailbox'}.`,
      };
    }
    return base;
  };

  try {
    let result: EmailSendResult;
    if (isListDrafts && session.provider === 'google') {
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
    } else if (isListDrafts) {
      const listed = await outlookListDrafts({ accessToken, maxResults: params.input.maxResults });
      result = withMailbox({ messageId: '', threadId: '', status: 'listed', mode: 'list_drafts', drafts: listed.drafts });
    } else if (isDeleteDraft && session.provider === 'google') {
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
    } else if (isDeleteDraft) {
      const deleted = await outlookDeleteDraft({ accessToken, draftId: params.input.draftId!.trim() });
      result = withMailbox({ messageId: '', threadId: '', status: 'deleted', draftId: deleted.draftId, mode: 'delete_draft' });
    } else if (isDraft && session.provider === 'google') {
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
    } else if (isDraft) {
      result = withMailbox(await outlookCreateDraft({
        accessToken, to: params.input.to, subject: params.input.subject, bodyText: params.input.bodyText,
      }));
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
    } else if (session.provider === 'google') {
      const sent = await gmailSend({
        accessToken,
        to: params.input.to,
        subject: params.input.subject,
        bodyText: params.input.bodyText,
        replyToMessageId: params.input.replyToMessageId ?? null,
      });
      result = withMailbox({ ...sent, mode: 'send' });
    } else {
      result = withMailbox(await outlookSend({
        accessToken, to: params.input.to, subject: params.input.subject, bodyText: params.input.bodyText,
        replyToMessageId: params.input.replyToMessageId ?? null,
      }));
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
        provider: session.provider,
        via: useN8n ? 'n8n' : session.provider === 'google' ? 'gmail_api' : 'graph_api',
      },
    });
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
    if (
      err instanceof EmailToolError ||
      err instanceof EmailProviderSelectionRequiredError ||
      err instanceof EmailProviderNotAvailableError
    ) throw err;
    throw new EmailToolError(String((err as Error)?.message ?? err));
  }
}

export async function hasEmailConnector(orgId: string): Promise<boolean> {
  return hasResolvedEmailConnector(orgId);
}
