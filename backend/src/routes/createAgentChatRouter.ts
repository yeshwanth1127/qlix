import { Router, raw, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import multer from 'multer';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { buildWebChatInbound, buildLocalInbound, gatewayService, replyDispatcher } from '../gateway/index.js';
import { inboundChannelFromRequest } from '../lib/runOrigin.js';
import {
  buildPromptWithAttachments,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_MB,
  processChatUploads,
  storedChatAttachments,
  type ChatAttachmentMeta,
} from '../agentChat/chatAttachment.service.js';
import {
  buildMemoryBlock,
  extractAndStoreMemories,
  storeRunnerLocalEnvironmentFacts,
  updateConversationSummary,
} from '../agentChat/agentMemory.service.js';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { assertRunnerAuth, RunnerUnauthorizedError } from '../agentChat/runnerAuth.js';
import { McpRepository } from '../mcp/mcp.repository.js';
import { askableAgentIds } from '../agents/peerAgentScopes.js';
import { drainInjections } from '../teams/runInjectionStore.js';
import { assertModelAllowed, ModelPolicyError, normalizeQlixInferenceModelId } from '../llm/modelPolicy.js';
import { appendAgentRunLogEvent, cancelAgentRun, ensureLocalConversation } from '../agentChat/agentRunService.js';
import {
  createLocalConversation,
  forkConversation,
  listConversationsForAgent,
} from '../agentChat/conversationService.js';
import { BrainQueryService } from '../aiBrain/brainQuery.service.js';
import {
  assertStandardAgentCanQueryBrain,
  BrainNotProvisionedError,
  BrainQueryForbiddenError,
  BrainWrongOrgError,
} from '../aiBrain/agentBrainAccess.js';
import {
  ConnectorNotConfiguredError,
  EmailComposeScopeMissingError,
  EmailScopeDeniedError,
  EmailToolError,
  executeEmailRead,
  executeEmailSend,
  N8nNotConfiguredError,
} from '../connectors/emailTool.service.js';
import {
  EmailProviderNotAvailableError,
  EmailProviderSelectionRequiredError,
} from '../connectors/emailConnector.service.js';
import {
  CALENDAR_CONNECT_INSTRUCTIONS,
  DOCS_CONNECT_INSTRUCTIONS,
  DRIVE_CONNECT_INSTRUCTIONS,
  FORMS_CONNECT_INSTRUCTIONS,
  GMAIL_CONNECT_INSTRUCTIONS,
  GMAIL_RECONNECT_FOR_DRAFT_INSTRUCTIONS,
  MEET_CONNECT_INSTRUCTIONS,
  SHEETS_CONNECT_INSTRUCTIONS,
  SLIDES_CONNECT_INSTRUCTIONS,
} from '../connectors/connectorUserMessages.js';
import {
  executeDriveRead,
  executeDriveWrite,
  DriveProviderNotAvailableError,
  DriveProviderSelectionRequiredError,
  GoogleConnectorNotConfiguredError as DriveConnectorNotConfiguredError,
  GoogleScopeDeniedError as DriveScopeDeniedError,
  GoogleToolError as DriveToolError,
} from '../connectors/driveTool.service.js';
import {
  executeDocsRead,
  executeDocsWrite,
  GoogleConnectorNotConfiguredError as DocsConnectorNotConfiguredError,
  GoogleScopeDeniedError as DocsScopeDeniedError,
  GoogleToolError as DocsToolError,
} from '../connectors/docsTool.service.js';
import {
  executeSheetsRead,
  executeSheetsWrite,
  GoogleConnectorNotConfiguredError as SheetsConnectorNotConfiguredError,
  GoogleScopeDeniedError as SheetsScopeDeniedError,
  GoogleToolError as SheetsToolError,
} from '../connectors/sheetsTool.service.js';
import {
  executeSlidesRead,
  executeSlidesWrite,
  GoogleConnectorNotConfiguredError as SlidesConnectorNotConfiguredError,
  GoogleScopeDeniedError as SlidesScopeDeniedError,
  GoogleToolError as SlidesToolError,
} from '../connectors/slidesTool.service.js';
import {
  executeFormsRead,
  executeFormsWrite,
  GoogleConnectorNotConfiguredError as FormsConnectorNotConfiguredError,
  GoogleScopeDeniedError as FormsScopeDeniedError,
  GoogleToolError as FormsToolError,
} from '../connectors/formsTool.service.js';
import {
  executeCalendarRead,
  executeCalendarWrite,
  GoogleConnectorNotConfiguredError as CalendarConnectorNotConfiguredError,
  GoogleScopeDeniedError as CalendarScopeDeniedError,
  GoogleToolError as CalendarToolError,
} from '../connectors/calendarTool.service.js';
import {
  executeMeetManage,
  GoogleConnectorNotConfiguredError as MeetConnectorNotConfiguredError,
  GoogleScopeDeniedError as MeetScopeDeniedError,
  GoogleToolError as MeetToolError,
} from '../connectors/meetTool.service.js';
import { GoogleConnectorNotConfiguredError } from '../connectors/googleToolContext.js';
import {
  executeSocialAnalytics,
  executeSocialChannels,
  executeSocialPostsList,
  executeSocialPublish,
  OrbitConnectorNotConfiguredError,
  SocialScopeDeniedError,
  SocialToolError,
} from '../connectors/socialTool.service.js';
import { JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import { getWhatsAppConnectorForAgent } from '../connectors/whatsappConnector.service.js';
import {
  getWhatsAppSessionStatus,
  isWhatsAppServiceConfigured,
  sendWhatsAppDocument,
  startWhatsAppSession,
} from '../connectors/whatsappServiceClient.js';
import {
  executeWhatsAppAutoReplySetInstructions,
  executeWhatsAppAutoReplyStatus,
  executeWhatsAppAutoReplyStop,
  executeWhatsAppContactSend,
  executeWhatsAppDocumentSend,
  executeWhatsAppListContacts,
  executeWhatsAppPollSend,
  executeWhatsAppReadChat,
  WhatsAppNotLinkedError,
  WhatsAppScopeDeniedError,
  WhatsAppToolError,
} from '../connectors/whatsappTool.service.js';
import { TeamOutboundProvenanceError } from '../teams/teamOutboundGuard.js';
import { recordSuccessfulEvent } from '../billings/lib/recordBillingEvent.js';
import { recordRunUsage } from '../billings/lib/recordRunUsage.js';
import { storeSandboxFile } from '../sandbox/sandboxClient.js';
import { registerCrmToolRoutes } from './registerCrmToolRoutes.js';
import { registerNotionToolRoutes } from './registerNotionToolRoutes.js';
import { registerSlackToolRoutes } from './registerSlackToolRoutes.js';
import {
  AgentNotFoundError,
  JitForbiddenError,
  JitRequestNotFoundError,
  JitService,
  NotJitScopeError,
} from '../jit/jit.service.js';

const createConversationBody = z.object({});

const postMessageBody = z.object({
  content: z.string().trim().min(1).max(20_000),
  skills: z.array(z.string().trim().min(1).max(120)).default([]),
  /** Canonical proxy model id (`openrouter/...`). Omit to use cloud runner manifest default. */
  model: z.string().trim().min(1).max(200).optional(),
  reasoningEffort: z
    .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .optional(),
  /** When true, cloud runner retrieves org brain context for this turn (requires `brain.query` on the agent). */
  useBrain: z.boolean().optional().default(false),
});

/** Edit a prior user message and re-enqueue (drops later messages + their runs). */
const editResendMessageBody = z.object({
  content: z.string().trim().max(20_000).default(''),
  skills: z.array(z.string().trim().min(1).max(120)).default([]),
  model: z.string().trim().min(1).max(200).optional(),
  reasoningEffort: z
    .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .optional(),
  useBrain: z.boolean().optional().default(false),
});

const chatMessageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_ATTACHMENT_MAX_BYTES, files: CHAT_ATTACHMENT_MAX_FILES },
});

/** Normalize stored AgentMessage.attachments JSON into ChatAttachmentMeta[]. */
function parseAttachmentsJson(raw: unknown): ChatAttachmentMeta[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: ChatAttachmentMeta[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (
      typeof a.id === 'string' &&
      typeof a.fileName === 'string' &&
      typeof a.mimeType === 'string' &&
      typeof a.url === 'string' &&
      typeof a.sizeBytes === 'number'
    ) {
      out.push({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        url: a.url,
        sizeBytes: a.sizeBytes,
        ...(typeof a.textPreview === 'string' ? { textPreview: a.textPreview } : {}),
      });
    }
  }
  return out;
}

function parseMultipartMessageFields(body: Record<string, unknown>): {
  content: string;
  skills: string[];
  model?: string;
  reasoningEffort?: string;
  useBrain: boolean;
} {
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  let skills: string[] = [];
  if (typeof body.skills === 'string' && body.skills.trim()) {
    try {
      const parsed = JSON.parse(body.skills) as unknown;
      if (Array.isArray(parsed)) {
        skills = parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
      }
    } catch {
      skills = [];
    }
  }
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
  const reasoningEffort =
    typeof body.reasoningEffort === 'string' && body.reasoningEffort.trim()
      ? body.reasoningEffort.trim()
      : undefined;
  const useBrain =
    body.useBrain === true ||
    body.useBrain === 'true' ||
    body.useBrain === '1';
  return { content, skills, model, reasoningEffort, useBrain };
}

const runnerBrainQueryBody = z.object({
  question: z.string().trim().min(1).max(4000).optional(),
  contextOnly: z.boolean().optional().default(true),
  collectionIds: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

const pollBody = z.object({
  maxWaitMs: z.number().int().min(0).max(30_000).default(0),
});

const runnerLocalEnvironmentBody = z.object({
  facts: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  fingerprint: z.string().trim().min(8).max(128),
});

const runnerLogBody = z.object({
  /** Client hint only; server assigns monotonic seq per run to avoid duplicate (run_id, seq). */
  seq: z.number().int().min(0).optional(),
  type: z.enum(['delta', 'log', 'status']),
  data: z.unknown(),
});

async function appendAgentRunEvent(
  runId: string,
  type: 'delta' | 'log' | 'status',
  data: unknown,
): Promise<number> {
  if (type === 'log' && data && typeof data === 'object' && !Array.isArray(data)) {
    return appendAgentRunLogEvent(runId, data as Record<string, unknown>);
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const agg = await prisma.agentRunEvent.aggregate({
      where: { runId },
      _max: { seq: true },
    });
    const seq = (agg._max.seq ?? -1) + 1;
    try {
      await prisma.agentRunEvent.create({
        data: { runId, seq, type, data: data as any },
      });
      const createdAt = new Date().toISOString();
      void import('../gateway/runEventBus.js')
        .then(({ runEventBus }) =>
          runEventBus.publish({ runId, seq, type, data, createdAt }),
        )
        .catch(() => undefined);
      return seq;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        attempt < 3
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to append run event after retries');
}

const runnerCompleteBody = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  errorMessage: z.string().max(10_000).optional(),
});

const emailReadBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  provider: z.enum(['google', 'microsoft']).optional(),
  query: z.string().trim().max(500).optional(),
  maxResults: z.number().int().min(1).max(25).optional(),
  messageId: z.string().trim().max(120).nullable().optional(),
  includeAttachments: z.boolean().optional(),
});

/** Pull a bare address from `"Name <a@b.com>"` / comma lists / `{ email }` objects. */
function coerceEmailRecipients(raw: unknown): string[] {
  const push = (out: string[], value: unknown) => {
    if (value == null) return;
    if (typeof value === 'string') {
      for (const part of value.split(/[,;]+/)) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const angled = trimmed.match(/<([^<>@\s]+@[^<>@\s]+)>/);
        out.push((angled?.[1] ?? trimmed).trim());
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) push(out, item);
      return;
    }
    if (typeof value === 'object' && value !== null && 'email' in value) {
      push(out, (value as { email?: unknown }).email);
    }
  };
  const out: string[] = [];
  push(out, raw);
  return out.filter(Boolean).slice(0, 20);
}

const emailSendBody = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const o = { ...(raw as Record<string, unknown>) };
    if (typeof o.mode === 'string') o.mode = o.mode.trim().toLowerCase();
    if (o.bodyText == null) {
      if (o.body != null) o.bodyText = o.body;
      else if (o.text != null) o.bodyText = o.text;
      else if (o.message != null) o.bodyText = o.message;
      else if (o.content != null) o.bodyText = o.content;
    }
    if (typeof o.bodyText !== 'string' && o.bodyText != null) {
      o.bodyText = String(o.bodyText);
    }
    if (typeof o.subject !== 'string' && o.subject != null) {
      o.subject = String(o.subject);
    }
    o.to = coerceEmailRecipients(o.to);
    if (typeof o.maxResults === 'string' && o.maxResults.trim()) {
      const n = Number(o.maxResults);
      if (Number.isFinite(n)) o.maxResults = Math.trunc(n);
    }
    return o;
  },
  z
    .object({
      runId: z.string().trim().min(1).max(80).optional(),
      provider: z.enum(['google', 'microsoft']).optional(),
      mode: z.enum(['send', 'draft', 'list_drafts', 'delete_draft']).optional().default('send'),
      to: z.array(z.string().email().max(320)).max(20).default([]),
      subject: z.string().trim().max(500).default(''),
      bodyText: z.string().trim().max(50_000).default(''),
      draftId: z.string().trim().min(1).max(120).nullable().optional(),
      maxResults: z.number().int().min(1).max(25).optional(),
      replyToMessageId: z.string().trim().max(120).nullable().optional(),
      jitToken: z.string().trim().min(8).max(512).nullable().optional(),
      metadata: z
        .object({
          campaignId: z.string().trim().min(1).max(80).optional(),
          leadId: z.string().trim().min(1).max(80).optional(),
        })
        .optional(),
    })
    .superRefine((data, ctx) => {
      if (data.mode === 'send' && data.to.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'to is required when mode is send',
          path: ['to'],
        });
      }
      if ((data.mode === 'send' || data.mode === 'draft') && !data.subject.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'subject is required when mode is send or draft',
          path: ['subject'],
        });
      }
      if ((data.mode === 'send' || data.mode === 'draft') && !data.bodyText.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'bodyText is required when mode is send or draft',
          path: ['bodyText'],
        });
      }
      if (data.mode === 'delete_draft' && !data.draftId?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'draftId is required when mode is delete_draft',
          path: ['draftId'],
        });
      }
    }),
);

const driveReadBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  provider: z.enum(['google', 'microsoft']).optional(),
  action: z.enum(['list', 'get', 'get_content']),
  query: z.string().trim().max(500).optional(),
  fileId: z.string().trim().max(200).optional(),
  parentId: z.string().trim().max(200).nullable().optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  pageToken: z.string().trim().max(2000).nullable().optional(),
});

const driveWriteBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  provider: z.enum(['google', 'microsoft']).optional(),
  action: z.enum(['create', 'update', 'delete']),
  fileId: z.string().trim().max(200).optional(),
  name: z.string().trim().max(500).optional(),
  contentText: z.string().max(200_000).optional(),
  mimeType: z.string().trim().max(200).optional(),
  parentId: z.string().trim().max(200).nullable().optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
});

const docsReadBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['get']),
  documentId: z.string().trim().max(200).optional(),
});

const docsWriteBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['create', 'append', 'replace_all']),
  documentId: z.string().trim().max(200).optional(),
  title: z.string().trim().max(500).optional(),
  text: z.string().max(200_000).optional(),
  findText: z.string().max(5000).optional(),
  replaceText: z.string().max(200_000).optional(),
  matchCase: z.boolean().optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
});

const sheetsReadBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['get', 'get_values']),
  spreadsheetId: z.string().trim().max(200).optional(),
  range: z.string().trim().max(500).optional(),
});

const sheetsWriteBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['create', 'update_values', 'append_values']),
  spreadsheetId: z.string().trim().max(200).optional(),
  title: z.string().trim().max(500).optional(),
  sheetTitle: z.string().trim().max(200).optional(),
  range: z.string().trim().max(500).optional(),
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(5000).optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
});

const slidesReadBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['get']),
  presentationId: z.string().trim().max(200).optional(),
});

const slidesWriteBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['create', 'replace_all', 'insert_text']),
  presentationId: z.string().trim().max(200).optional(),
  title: z.string().trim().max(500).optional(),
  text: z.string().max(50_000).optional(),
  findText: z.string().max(5000).optional(),
  replaceText: z.string().max(50_000).optional(),
  matchCase: z.boolean().optional(),
  pageObjectId: z.string().trim().max(200).optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
});

const formsReadBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['get', 'list_responses']),
  formId: z.string().trim().max(200).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().trim().max(500).optional(),
});

const formsWriteBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['create', 'update_info', 'add_question']),
  formId: z.string().trim().max(200).optional(),
  title: z.string().trim().max(500).optional(),
  description: z.string().trim().max(10_000).optional(),
  questionTitle: z.string().trim().max(500).optional(),
  required: z.boolean().optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
});

const calendarReadBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['list', 'get']),
  eventId: z.string().trim().max(200).optional(),
  calendarId: z.string().trim().max(200).optional(),
  timeMin: z.string().trim().max(80).optional(),
  timeMax: z.string().trim().max(80).optional(),
  query: z.string().trim().max(500).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});

const calendarWriteBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['create', 'update', 'delete']),
  eventId: z.string().trim().max(200).optional(),
  calendarId: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(500).optional(),
  description: z.string().trim().max(10_000).optional(),
  location: z.string().trim().max(500).optional(),
  start: z.string().trim().max(80).optional(),
  end: z.string().trim().max(80).optional(),
  attendees: z.array(z.string().email().max(320)).max(50).optional(),
  createMeetLink: z.boolean().optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
});

const meetManageBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['create', 'get', 'end']),
  name: z.string().trim().max(200).optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
});

const whatsappListContactsBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const whatsappReadChatBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  recipient: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(80).optional(),
});

const whatsappContactSendBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  recipient: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
  replyInstructions: z.string().trim().min(1).max(2000).optional(),
});

const whatsappPollSendBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  recipient: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(255),
  values: z.array(z.string().trim().min(1).max(100)).min(2).max(12),
  selectableCount: z.number().int().min(1).max(12).optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
  replyInstructions: z.string().trim().min(1).max(2000).optional(),
});

const whatsappContactDocumentSendBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  recipient: z.string().trim().min(1).max(200),
  file_name: z.string().trim().min(1).max(255).optional(),
  mimetype: z.string().trim().max(255).optional(),
  content_base64: z.string().min(1).max(28_000_000).optional(),
  brain_document_id: z.string().trim().min(1).max(80).optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
  replyInstructions: z.string().trim().min(1).max(2000).optional(),
}).refine(
  (v) => Boolean(v.content_base64?.trim()) || Boolean(v.brain_document_id?.trim()),
  { message: 'content_base64 or brain_document_id is required' },
);

const whatsappAutoReplyStopBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  recipient: z.string().trim().min(1).max(200).optional(),
});

const whatsappAutoReplyStatusBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
});

const whatsappAutoReplyInstructionsBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  recipient: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(2000),
});

const socialChannelsBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
});

const socialPostsListBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  startDate: z.string().trim().max(40).optional(),
  endDate: z.string().trim().max(40).optional(),
});

const socialAnalyticsBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  integrationId: z.string().trim().min(1).max(120),
});

const socialPublishBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
  payload: z.unknown(),
});

const whatsappSendDocumentBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  file_path: z.string().trim().min(1).max(4096),
  file_name: z.string().trim().min(1).max(255).optional(),
});

// Cloud runners don't share a filesystem with the WhatsApp service, so they upload
// the file bytes (base64) instead of a path. ~28M base64 chars ≈ 20MB decoded.
const whatsappSendFileBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  file_name: z.string().trim().min(1).max(255),
  mimetype: z.string().trim().max(255).optional(),
  content_base64: z.string().min(1).max(28_000_000),
});

// Report PDF upload cap — large enough for a ~25-page PDF with images.
const REPORT_PDF_MAX_BYTES = 50 * 1024 * 1024;
const SANDBOX_FILE_MAX_BYTES = REPORT_PDF_MAX_BYTES;

async function storeRunnerSandboxUpload(
  request: Request,
  response: Response,
  agentId: string,
  defaultFileName: string,
  defaultContentType: string,
): Promise<void> {
  try {
    await assertRunnerAuth(agentId, request);
    const buffer = request.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'request body (file bytes) is required' } });
      return;
    }
    if (buffer.length > SANDBOX_FILE_MAX_BYTES) {
      response.status(413).json({ error: { code: 'file_too_large', message: 'File exceeds the size limit' } });
      return;
    }
    const fileName = String(request.header('x-file-name') || defaultFileName);
    const contentType = String(request.header('x-content-type') || defaultContentType);
    const stored = await storeSandboxFile(buffer, fileName, contentType);
    response.json({ ok: true, url: stored.url, expiresAt: stored.expiresAt });
  } catch (err) {
    if (err instanceof RunnerUnauthorizedError) {
      response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
      return;
    }
    throw err;
  }
}

/**
 * Shared WhatsApp document delivery: verify the service + linked connector + live
 * session, then hand the file path to the WhatsApp service. Returns a structured
 * error so callers can map it to an HTTP status.
 */
async function deliverWhatsAppDocumentForAgent(
  agentId: string,
  filePath: string,
  fileName: string | undefined,
  mimetype?: string,
): Promise<{ ok: true; fileName: string } | { ok: false; status: number; code: string; message: string }> {
  if (!isWhatsAppServiceConfigured()) {
    return { ok: false, status: 409, code: 'whatsapp_not_configured', message: 'WhatsApp service is not configured on the backend' };
  }
  const connector = await getWhatsAppConnectorForAgent(agentId);
  if (!connector) {
    return { ok: false, status: 409, code: 'whatsapp_not_linked', message: 'WhatsApp is not linked for this agent. Link it in Connectors.' };
  }

  let session = await getWhatsAppSessionStatus(connector.id);
  if (!session.connected) {
    const restarted = await startWhatsAppSession(connector.id);
    if (restarted.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      session = await getWhatsAppSessionStatus(connector.id);
    }
  }
  if (!session.connected) {
    return { ok: false, status: 503, code: 'whatsapp_offline', message: 'WhatsApp session is offline — re-link WhatsApp in Connectors.' };
  }

  const { resolveWhatsAppDocumentIdentity } = await import('../whatsapp/documentFileIdentity.js');
  let bytes: Buffer | null = null;
  try {
    bytes = await readFile(filePath);
  } catch {
    bytes = null;
  }
  const identity = resolveWhatsAppDocumentIdentity({
    fileName,
    fallbackName: filePath.split(/[/\\]/).pop() ?? 'document',
    bytes,
    mimetype,
  });

  const sent = await sendWhatsAppDocument({
    connectorId: connector.id,
    filePath,
    fileName: identity.fileName,
    mimetype: identity.mimetype,
  });
  if (!sent.ok) {
    return { ok: false, status: 503, code: 'whatsapp_send_failed', message: sent.error ?? 'Document send failed' };
  }
  return { ok: true, fileName: identity.fileName };
}

async function assertOwnsAgent(request: Request, agentId: string): Promise<{ userId: string; orgId: string }> {
  const auth = request.auth!;
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, userId: true, orgId: true },
  });
  if (!agent) {
    throw Object.assign(new Error('Agent not found'), { status: 404, code: 'not_found' });
  }
  const owns = agent.userId === auth.userId || (agent.orgId && agent.orgId === auth.orgId);
  if (!owns) {
    throw Object.assign(new Error('Forbidden'), { status: 403, code: 'forbidden' });
  }
  return { userId: auth.userId, orgId: agent.orgId ?? auth.orgId };
}

const STALE_RUNNING_MS = 5 * 60_000;

async function recoverStaleRuns(agentId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
  await prisma.agentRun.updateMany({
    where: {
      agentId,
      status: 'running',
      startedAt: { lt: staleBefore },
      finishedAt: null,
    },
    data: {
      status: 'queued',
      startedAt: null,
      errorMessage: null,
    },
  });
}

async function claimNextQueuedRun(agentId: string): Promise<{
  id: string;
  prompt: string;
  attachments: unknown;
  skills: string[];
  conversationId: string;
  userId: string;
  createdAt: Date;
  inferenceModel: string | null;
  reasoningEffort: string | null;
  useBrain: boolean;
  teamRunId: string | null;
} | null> {
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH next_run AS (
      SELECT id
      FROM agent_runs
      WHERE agent_id = ${agentId}
        AND status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE agent_runs r
    SET status = 'running',
        started_at = NOW()
    FROM next_run
    WHERE r.id = next_run.id
    RETURNING r.id
  `);
  const id = claimed[0]?.id;
  if (!id) return null;
  const row = await prisma.agentRun.findUnique({
    where: { id },
    select: {
      id: true,
      prompt: true,
      attachments: true,
      skills: true,
      conversationId: true,
      userId: true,
      createdAt: true,
      inferenceModel: true,
      reasoningEffort: true,
      useBrain: true,
      teamRunId: true,
    },
  });
  return row;
}

const RUN_TERMINAL_STATUSES = new Set(['success', 'failed', 'canceled', 'cancelled']);

function extractRunResultText(result: unknown): string | undefined {
  if (typeof result === 'string') {
    const t = result.trim();
    return t || undefined;
  }
  if (result == null) return undefined;
  try {
    const t = JSON.stringify(result, null, 2).trim();
    return t && t !== '{}' && t !== 'null' ? t : undefined;
  } catch {
    return undefined;
  }
}

async function streamAgentRunEvents(
  request: Request,
  response: Response,
  agentId: string,
  runId: string,
): Promise<void> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { id: true, agentId: true, status: true, conversationId: true, startedAt: true, result: true },
  });
  if (!run || run.agentId !== agentId) {
    response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
    return;
  }

  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders?.();

  let lastSeq = -1;
  const start = Date.now();
  const maxMs = 600_000;
  let closed = false;
  // Serialize every SSE write. The EventBus listener and the poll interval otherwise
  // interleave `event:` / `data:` lines (especially during the final delta flood), so
  // clients pair `event: done` with a delta payload and see an empty reply.
  let writeChain: Promise<void> = Promise.resolve();

  const writeEvent = (event: string, data: unknown, allowAfterClose = false) => {
    if (closed && !allowAfterClose) return;
    writeChain = writeChain.then(() => {
      if (closed && !allowAfterClose) return;
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
      // Express / compression may buffer; flush so hybrid TTY and Active Runs see
      // tool + JIT events in real time (not only when the buffer fills or the run ends).
      const flushable = response as Response & { flush?: () => void };
      if (typeof flushable.flush === 'function') {
        flushable.flush();
      }
    }).catch(() => undefined);
  };

  const resolveAssistant = async (): Promise<string | undefined> => {
    // Prefer this run's result — conversation-latest agent message can be from a prior
    // run, and may also race the complete() transaction.
    const fresh = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: { result: true, startedAt: true, finishedAt: true },
    });
    const fromResult = extractRunResultText(fresh?.result);
    if (fromResult) return fromResult;

    if (!run.conversationId) return undefined;
    const since = fresh?.startedAt ?? run.startedAt ?? undefined;
    const agentMsg = await prisma.agentMessage.findFirst({
      where: {
        conversationId: run.conversationId,
        role: 'agent',
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    return agentMsg?.content?.trim() || undefined;
  };

  let unsubscribe: () => void = () => undefined;
  let interval: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;

  const endStream = (status: string, assistant: string | null = null, error?: string | null) => {
    if (closed) return;
    closed = true;
    if (interval) clearInterval(interval);
    // Stop live bus writes before the terminal frame so `done` cannot interleave
    // with a late delta from Redis/in-process pubsub.
    unsubscribe();
    unsubscribe = () => undefined;
    writeEvent(
      'done',
      {
        status,
        assistant,
        ...(error ? { error } : {}),
      },
      true,
    );
    void writeChain.finally(() => {
      try {
        response.end();
      } catch {
        // ignore
      }
    });
  };

  const pumpEvents = async (): Promise<void> => {
    const events = await prisma.agentRunEvent.findMany({
      where: { runId, seq: { gt: lastSeq } },
      orderBy: { seq: 'asc' },
      take: 200,
      select: { seq: true, type: true, data: true, createdAt: true },
    });
    for (const e of events) {
      lastSeq = Math.max(lastSeq, e.seq);
      writeEvent(e.type, { seq: e.seq, data: e.data, createdAt: e.createdAt.toISOString() });
    }
  };

  // Dump backlog immediately so late subscribers (local chat) see JIT/tools that
  // already landed — do not wait for the first poll tick.
  try {
    await pumpEvents();
  } catch {
    endStream('failed', null, 'stream_error');
    return;
  }

  if (RUN_TERMINAL_STATUSES.has(run.status)) {
    const assistant = (await resolveAssistant()) ?? extractRunResultText(run.result) ?? null;
    endStream(run.status === 'cancelled' ? 'canceled' : run.status, assistant);
    return;
  }

  const { runEventBus } = await import('../gateway/runEventBus.js');
  unsubscribe = await runEventBus.subscribe(runId, (ev) => {
    if (closed || ev.seq <= lastSeq) return;
    lastSeq = Math.max(lastSeq, ev.seq);
    writeEvent(ev.type, { seq: ev.seq, data: ev.data, createdAt: ev.createdAt });
  });

  interval = setInterval(() => {
    if (closed || pollInFlight) return;
    pollInFlight = true;
    void (async () => {
      try {
        await pumpEvents();

        const r = await prisma.agentRun.findUnique({
          where: { id: runId },
          select: { status: true, result: true },
        });
        const timedOut = Date.now() - start > maxMs;
        const status = r?.status ?? 'unknown';
        const isCanceled = status === 'canceled' || status === 'cancelled';
        const isFailed = status === 'failed';
        let readyToClose = isFailed || isCanceled || timedOut;
        if (status === 'success') {
          // complete() writes status + result in one transaction; result is the
          // reliable signal. Do not treat an older conversation agent message as
          // "this run's reply is ready".
          readyToClose = Boolean(extractRunResultText(r?.result));
        }
        if (readyToClose) {
          const assistant = (await resolveAssistant()) ?? null;
          const doneStatus = timedOut && !RUN_TERMINAL_STATUSES.has(status)
            ? 'timeout'
            : isCanceled
              ? 'canceled'
              : status;
          endStream(
            doneStatus,
            assistant,
            isCanceled ? 'Stopped by user' : timedOut ? 'stream timed out' : null,
          );
        }
      } catch {
        endStream('failed', null, 'stream_error');
      } finally {
        pollInFlight = false;
      }
    })();
  }, 400);

  request.on('close', () => {
    if (closed) return;
    closed = true;
    if (interval) clearInterval(interval);
    unsubscribe();
  });
}

export function createAgentChatRouter(): Router {
  const router = Router({ mergeParams: true });

  // UI: create or get default conversation (per agent + user).
  router.post('/:agentId/conversations', authenticateUser(true), requireSubscriptionAccess, async (request: Request, response: Response) => {
    const parsed = createConversationBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    try {
      const agentId = String(request.params.agentId);
      await assertOwnsAgent(request, agentId);

      const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
      const convo = await getOrCreatePrimaryConversation({
        agentId,
        userId: request.auth!.userId,
        orgId: request.auth!.orgId,
      });

      response.json({ conversationId: convo.id, createdAt: convo.createdAt.toISOString() });
    } catch (e: any) {
      response.status(e?.status ?? 500).json({
        error: { code: e?.code ?? 'internal_error', message: e?.message ?? 'Failed to create conversation' },
      });
    }
  });

  // UI: list messages
  router.get(
    '/:agentId/conversations/:conversationId/messages',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const conversationId = String(request.params.conversationId);
        await assertOwnsAgent(request, agentId);

        const convo = await prisma.agentConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, agentId: true, userId: true },
        });
        if (!convo || convo.agentId !== agentId || convo.userId !== request.auth!.userId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
          return;
        }

        const messages = await prisma.agentMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          take: 200,
          select: { id: true, role: true, content: true, attachments: true, createdAt: true },
        });
        response.json({
          messages: messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            attachments: m.attachments ?? null,
            createdAt: m.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        console.error('list messages error', err);
        response.status(500).json({ error: { code: 'messages_list_failed', message: 'Failed to list messages' } });
      }
    },
  );

  // UI: clear all messages for this conversation
  router.delete(
    '/:agentId/conversations/:conversationId/messages',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const conversationId = String(request.params.conversationId);
        await assertOwnsAgent(request, agentId);

        const convo = await prisma.agentConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, agentId: true, userId: true },
        });
        if (!convo || convo.agentId !== agentId || convo.userId !== request.auth!.userId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
          return;
        }

        await prisma.$transaction(async (tx) => {
          await tx.agentRunEvent.deleteMany({
            where: {
              run: {
                conversationId,
              },
            },
          });
          await tx.agentRun.deleteMany({ where: { conversationId } });
          await tx.agentMessage.deleteMany({ where: { conversationId } });
        });

        response.json({ ok: true });
      } catch (err) {
        console.error('clear messages error', err);
        response.status(500).json({ error: { code: 'messages_clear_failed', message: 'Failed to clear messages' } });
      }
    },
  );

  // UI: edit a prior user message and re-send (truncates later replies/runs).
  router.post(
    '/:agentId/conversations/:conversationId/messages/:messageId/resend',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const conversationId = String(request.params.conversationId);
        const messageId = String(request.params.messageId);
        await assertOwnsAgent(request, agentId);

        const parsed = editResendMessageBody.safeParse(request.body ?? {});
        if (!parsed.success) {
          response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid edit/resend payload' } });
          return;
        }

        const convo = await prisma.agentConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, agentId: true, userId: true, orgId: true },
        });
        if (!convo || convo.agentId !== agentId || convo.userId !== request.auth!.userId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
          return;
        }

        const messages = await prisma.agentMessage.findMany({
          where: { conversationId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, role: true, content: true, attachments: true, createdAt: true },
        });
        const idx = messages.findIndex((m) => m.id === messageId);
        if (idx < 0) {
          response.status(404).json({ error: { code: 'not_found', message: 'Message not found' } });
          return;
        }
        const target = messages[idx]!;
        if (target.role !== 'user') {
          response.status(400).json({
            error: { code: 'invalid_message', message: 'Only user messages can be edited and resent' },
          });
          return;
        }
        if (target.content.startsWith('[steer]')) {
          response.status(400).json({
            error: { code: 'invalid_message', message: 'Steer notes cannot be edited' },
          });
          return;
        }

        const content = parsed.data.content;
        const priorAttachments = parseAttachmentsJson(target.attachments);
        if (!content && priorAttachments.length === 0) {
          response.status(400).json({
            error: { code: 'invalid_body', message: 'Edited message text or existing attachments are required' },
          });
          return;
        }

        let inferenceModel: string | null = null;
        if (parsed.data.model != null && parsed.data.model.length > 0) {
          inferenceModel = normalizeQlixInferenceModelId(parsed.data.model);
          assertModelAllowed(inferenceModel);
        }
        const reasoningEffort = parsed.data.reasoningEffort ?? null;

        const cutAt = target.createdAt;
        const toDeleteIds = messages.slice(idx).map((m) => m.id);

        await prisma.$transaction(async (tx) => {
          // Stop any in-flight runs for this conversation from this turn onward.
          await tx.agentRun.updateMany({
            where: {
              conversationId,
              createdAt: { gte: cutAt },
              status: { notIn: ['success', 'failed', 'canceled', 'cancelled'] },
            },
            data: {
              status: 'canceled',
              finishedAt: new Date(),
              errorMessage: 'Superseded by message edit',
            },
          });

          const runsToDrop = await tx.agentRun.findMany({
            where: { conversationId, createdAt: { gte: cutAt } },
            select: { id: true },
          });
          const runIds = runsToDrop.map((r) => r.id);
          if (runIds.length > 0) {
            await tx.agentRunEvent.deleteMany({ where: { runId: { in: runIds } } });
            await tx.agentRun.deleteMany({ where: { id: { in: runIds } } });
          }

          await tx.agentMessage.deleteMany({ where: { id: { in: toDeleteIds } } });
        });

        const runnerPrompt =
          priorAttachments.length > 0
            ? buildPromptWithAttachments(
                content,
                priorAttachments.map((a) => ({
                  ...a,
                  ...(a.textPreview ? { extractedText: a.textPreview } : {}),
                })),
              )
            : content;

        const turn = await gatewayService.handleInbound(
          buildWebChatInbound({
            agentId,
            conversationId,
            userId: request.auth!.userId,
            orgId: convo.orgId,
            email: request.auth!.email,
            body: runnerPrompt,
            displayBody: content,
            attachments: priorAttachments.length > 0 ? priorAttachments : undefined,
            skills: parsed.data.skills,
            inferenceModel,
            reasoningEffort,
            useBrain: parsed.data.useBrain,
            channel: inboundChannelFromRequest(request),
          }),
        );

        if (turn.status === 'accepted') {
          response.status(201).json({ messageId: turn.messageId, runId: turn.runId });
          return;
        }
        if (turn.status === 'steered') {
          response.status(202).json({ runId: turn.runId, status: 'steered' });
          return;
        }
        const message =
          turn.status === 'rejected'
            ? turn.reason
            : (turn.ackReply ?? 'Gateway could not accept message');
        response.status(turn.status === 'rejected' ? 409 : 202).json({
          error: {
            code: turn.status === 'rejected' ? 'gateway_rejected' : 'gateway_busy',
            message,
          },
        });
      } catch (err) {
        if (err instanceof ModelPolicyError) {
          response.status(400).json({ error: { code: 'model_not_allowed', message: err.message } });
          return;
        }
        if ((err as any)?.code === 'insufficient_balance') {
          response.status(402).json({ error: { code: 'insufficient_balance', message: (err as Error).message } });
          return;
        }
        console.error('edit/resend message error', err);
        response.status(500).json({
          error: { code: 'message_resend_failed', message: 'Failed to edit and resend message' },
        });
      }
    },
  );

  // UI: post a user message -> enqueue run (JSON or multipart with up to 8 files)
  router.post(
    '/:agentId/conversations/:conversationId/messages',
    authenticateUser(true),
    requireSubscriptionAccess,
    (request: Request, response: Response, next) => {
      if (request.is('multipart/form-data')) {
        chatMessageUpload.array('files', CHAT_ATTACHMENT_MAX_FILES)(request, response, (err) => {
          if (err instanceof multer.MulterError) {
            response.status(400).json({
              error: {
                code: 'upload_error',
                message:
                  err.code === 'LIMIT_FILE_SIZE'
                    ? `File is too large (max ${CHAT_ATTACHMENT_MAX_MB} MB).`
                    : err.code === 'LIMIT_FILE_COUNT'
                      ? `Too many files (max ${CHAT_ATTACHMENT_MAX_FILES}).`
                      : err.message,
              },
            });
            return;
          }
          if (err) {
            response.status(400).json({ error: { code: 'upload_error', message: 'File upload failed' } });
            return;
          }
          next();
        });
        return;
      }
      next();
    },
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const conversationId = String(request.params.conversationId);
        await assertOwnsAgent(request, agentId);

        const convo = await prisma.agentConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, agentId: true, userId: true, orgId: true },
        });
        if (!convo || convo.agentId !== agentId || convo.userId !== request.auth!.userId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
          return;
        }

        const isMultipart = request.is('multipart/form-data');
        let content: string;
        let skills: string[];
        let model: string | undefined;
        let reasoningEffort: string | undefined;
        let useBrain: boolean;
        let storedAttachments: ChatAttachmentMeta[] = [];
        let processedAttachments: Awaited<ReturnType<typeof processChatUploads>> = [];

        if (isMultipart) {
          const fields = parseMultipartMessageFields(request.body as Record<string, unknown>);
          content = fields.content;
          skills = fields.skills;
          model = fields.model;
          reasoningEffort = fields.reasoningEffort;
          useBrain = fields.useBrain;
          processedAttachments = await processChatUploads((request.files as Express.Multer.File[]) ?? []);
          storedAttachments = storedChatAttachments(processedAttachments);
          if (!content && storedAttachments.length === 0) {
            response.status(400).json({
              error: { code: 'invalid_body', message: 'Message text or at least one file is required' },
            });
            return;
          }
          if (content.length > 20_000) {
            response.status(400).json({ error: { code: 'invalid_body', message: 'Message is too long' } });
            return;
          }
        } else {
          const parsed = postMessageBody.safeParse(request.body);
          if (!parsed.success) {
            response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid message payload' } });
            return;
          }
          content = parsed.data.content;
          skills = parsed.data.skills;
          model = parsed.data.model;
          reasoningEffort = parsed.data.reasoningEffort;
          useBrain = parsed.data.useBrain;
        }

        let inferenceModel: string | null = null;
        if (model != null && model.length > 0) {
          inferenceModel = normalizeQlixInferenceModelId(model);
          assertModelAllowed(inferenceModel);
        }

        const runnerPrompt =
          processedAttachments.length > 0
            ? buildPromptWithAttachments(content, processedAttachments)
            : content;

        const turn = await gatewayService.handleInbound(
          buildWebChatInbound({
            agentId,
            conversationId,
            userId: request.auth!.userId,
            orgId: convo.orgId,
            email: request.auth!.email,
            body: runnerPrompt,
            displayBody: content,
            attachments: storedAttachments.length > 0 ? storedAttachments : undefined,
            skills,
            inferenceModel,
            reasoningEffort: reasoningEffort ?? null,
            useBrain,
            channel: inboundChannelFromRequest(request),
          }),
        );

        if (turn.status === 'accepted') {
          response.status(201).json({ messageId: turn.messageId, runId: turn.runId });
          return;
        }
        if (turn.status === 'steered') {
          response.status(202).json({ runId: turn.runId, status: 'steered' });
          return;
        }
        const message =
          turn.status === 'rejected'
            ? turn.reason
            : (turn.ackReply ?? 'Gateway could not accept message');
        response.status(turn.status === 'rejected' ? 409 : 202).json({
          error: {
            code: turn.status === 'rejected' ? 'gateway_rejected' : 'gateway_busy',
            message,
          },
        });
      } catch (err) {
        if (err instanceof ModelPolicyError) {
          response.status(400).json({ error: { code: 'model_not_allowed', message: err.message } });
          return;
        }
        if ((err as any)?.code === 'insufficient_balance') {
          response.status(402).json({ error: { code: 'insufficient_balance', message: (err as Error).message } });
          return;
        }
        if ((err as any)?.code === 'too_many_files' || (err as any)?.code === 'file_too_large') {
          response.status((err as any).status ?? 400).json({
            error: { code: (err as any).code, message: (err as Error).message },
          });
          return;
        }
        console.error('post message error', err);
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2028') {
          response.status(503).json({
            error: {
              code: 'message_enqueue_timeout',
              message: 'Backend queue is busy. Please retry sending the message.',
            },
          });
          return;
        }
        response.status(500).json({ error: { code: 'message_post_failed', message: 'Failed to post message' } });
      }
    },
  );

  const localMessageBody = z.object({
    message: z.string().trim().min(1).max(32_000),
    conversationId: z.string().trim().min(1).max(80).optional(),
  });

  // Hybrid runner: enqueue a local-terminal chat turn (channel=local).
  router.post('/:agentId/runner/local-message', async (request: Request, response: Response) => {
    const parsed = localMessageBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'message required' } });
      return;
    }
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);

      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          name: true,
          userId: true,
          orgId: true,
          runtime: true,
          user: { select: { email: true } },
        },
      });
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      if (agent.runtime !== 'hybrid') {
        response.status(409).json({
          error: { code: 'not_hybrid', message: 'Local terminal chat requires a hybrid agent' },
        });
        return;
      }

      let conversationId: string;
      try {
        conversationId = await ensureLocalConversation({
          agentId: agent.id,
          userId: agent.userId,
          orgId: agent.orgId,
          conversationId: parsed.data.conversationId,
        });
      } catch (e: any) {
        if (e?.code === 'conversation_not_found') {
          response.status(404).json({ error: { code: e.code, message: e.message } });
          return;
        }
        throw e;
      }

      const turn = await gatewayService.handleInbound(
        buildLocalInbound({
          agentId: agent.id,
          conversationId,
          userId: agent.userId,
          orgId: agent.orgId,
          email: agent.user?.email ?? undefined,
          body: parsed.data.message,
          agentName: agent.name,
        }),
      );

      if (turn.status === 'rejected') {
        response.status(400).json({
          error: { code: 'local_message_rejected', message: turn.reason ?? 'Rejected' },
        });
        return;
      }
      if (turn.status === 'steered') {
        response.status(202).json({
          conversationId,
          runId: turn.runId,
          status: 'steered',
        });
        return;
      }
      if (turn.status !== 'accepted') {
        response.status(500).json({
          error: { code: 'local_message_failed', message: 'Unexpected gateway result' },
        });
        return;
      }

      response.status(201).json({
        conversationId,
        runId: turn.runId,
        messageId: turn.messageId,
        status: 'accepted',
        channel: 'local',
      });
    } catch (e: unknown) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      console.error('runner local-message error', e);
      response.status(500).json({
        error: { code: 'local_message_failed', message: 'Failed to enqueue local message' },
      });
    }
  });

  // Hybrid runner: list / create / fork conversations + history + JIT decide
  router.get('/:agentId/runner/conversations', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { userId: true },
      });
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const conversations = await listConversationsForAgent({
        agentId,
        userId: agent.userId,
      });
      response.json({ conversations });
    } catch (e: unknown) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      response.status(500).json({ error: { code: 'list_failed', message: 'Failed to list conversations' } });
    }
  });

  router.post('/:agentId/runner/conversations', async (request: Request, response: Response) => {
    const schema = z.object({ title: z.string().trim().min(1).max(120).optional() });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { userId: true, orgId: true, runtime: true },
      });
      if (!agent || agent.runtime !== 'hybrid') {
        response.status(409).json({ error: { code: 'not_hybrid', message: 'Hybrid agent required' } });
        return;
      }
      const convo = await createLocalConversation({
        agentId,
        userId: agent.userId,
        orgId: agent.orgId,
        title: parsed.data.title,
      });
      response.status(201).json({ conversation: convo });
    } catch (e: unknown) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      response.status(500).json({ error: { code: 'create_failed', message: 'Failed to create conversation' } });
    }
  });

  router.post('/:agentId/runner/conversations/:conversationId/fork', async (request: Request, response: Response) => {
    const schema = z.object({ title: z.string().trim().min(1).max(120).optional() });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    const conversationId = String(request.params.conversationId);
    try {
      await assertRunnerAuth(agentId, request);
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { userId: true, orgId: true, runtime: true },
      });
      if (!agent || agent.runtime !== 'hybrid') {
        response.status(409).json({ error: { code: 'not_hybrid', message: 'Hybrid agent required' } });
        return;
      }
      const forked = await forkConversation({
        agentId,
        userId: agent.userId,
        orgId: agent.orgId,
        sourceConversationId: conversationId,
        title: parsed.data.title,
      });
      response.status(201).json({ conversation: forked });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e?.code === 'conversation_not_found') {
        response.status(404).json({ error: { code: e.code, message: e.message } });
        return;
      }
      response.status(500).json({ error: { code: 'fork_failed', message: 'Failed to fork conversation' } });
    }
  });

  router.get(
    '/:agentId/runner/conversations/:conversationId/messages',
    async (request: Request, response: Response) => {
      const agentId = String(request.params.agentId);
      const conversationId = String(request.params.conversationId);
      const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? 50) || 50));
      try {
        await assertRunnerAuth(agentId, request);
        const agent = await prisma.agent.findUnique({
          where: { id: agentId },
          select: { userId: true },
        });
        if (!agent) {
          response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
          return;
        }
        const convo = await prisma.agentConversation.findFirst({
          where: { id: conversationId, agentId, userId: agent.userId },
          select: { id: true, title: true, kind: true },
        });
        if (!convo) {
          response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
          return;
        }
        const messages = await prisma.agentMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          take: limit,
          select: { id: true, role: true, content: true, createdAt: true },
        });
        response.json({
          conversation: convo,
          messages: messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt.toISOString(),
          })),
        });
      } catch (e: unknown) {
        if (e instanceof RunnerUnauthorizedError) {
          response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
          return;
        }
        response.status(500).json({ error: { code: 'messages_failed', message: 'Failed to load messages' } });
      }
    },
  );

  router.post('/:agentId/runner/jit/decide', async (request: Request, response: Response) => {
    const schema = z.object({
      jitRequestId: z.string().trim().min(1).max(80),
      approved: z.boolean(),
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'jitRequestId and approved required' } });
      return;
    }
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const jit = new JitService();
      const result = await jit.decideFromRunner({
        jitRequestId: parsed.data.jitRequestId,
        agentId,
        approved: parsed.data.approved,
      });
      response.json(result);
    } catch (e: unknown) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e instanceof JitRequestNotFoundError) {
        response.status(404).json({ error: { code: e.code, message: 'JIT request not found' } });
        return;
      }
      if (e instanceof JitForbiddenError) {
        response.status(403).json({ error: { code: e.code, message: e.message } });
        return;
      }
      console.error('runner jit decide error', e);
      response.status(500).json({ error: { code: 'jit_decide_failed', message: 'Failed to decide JIT' } });
    }
  });

  // Runner: org brain query (retrieval or full RAG) — auditable via run ownership + runner token.
  router.post('/:agentId/runs/:runId/brain/query', async (request: Request, response: Response) => {
    const parsed = runnerBrainQueryBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid brain query body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { id: true, agentId: true, userId: true, orgId: true, prompt: true },
      });
      if (!run || run.agentId !== agentId) {
        response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
        return;
      }
      const worker = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { orgId: true },
      });
      const orgId = worker?.orgId ?? run.orgId;
      if (!orgId) {
        response.status(409).json({
          error: { code: 'brain_org_required', message: 'Agent must belong to an organization to use AI brain' },
        });
        return;
      }
      const access = await assertStandardAgentCanQueryBrain(agentId, orgId);
      const question = (parsed.data.question?.trim() || run.prompt).trim();
      if (!question) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'No question text (empty run prompt)' } });
        return;
      }
      const queryService = new BrainQueryService();
      const result = await queryService.queryBrain({
        userId: run.userId,
        orgId,
        brainAgentId: access.brainAgentId,
        brainModel: access.brainModel,
        question,
        collectionIds: parsed.data.collectionIds,
        auditSurface: 'agent_tool',
        callingAgentId: agentId,
        contextOnly: parsed.data.contextOnly,
        writeAudit: true,
      });
      response.json(result);
    } catch (e: unknown) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e instanceof BrainQueryForbiddenError) {
        response.status(403).json({ error: { code: e.code, message: e.message } });
        return;
      }
      if (e instanceof BrainNotProvisionedError) {
        response.status(409).json({ error: { code: e.code, message: e.message } });
        return;
      }
      if (e instanceof BrainWrongOrgError) {
        response.status(403).json({ error: { code: e.code, message: e.message } });
        return;
      }
      console.error('runner brain/query', e);
      response.status(500).json({ error: { code: 'brain_query_failed', message: 'Brain query failed' } });
    }
  });

  // Runner: list/find brain documents (for sending originals via WhatsApp).
  router.post('/:agentId/tools/brain/find-documents', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    const body = z
      .object({
        runId: z.string().trim().min(1).max(80).optional(),
        query: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid find-documents body' } });
      return;
    }
    try {
      await assertRunnerAuth(agentId, request);
      const worker = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { orgId: true },
      });
      const orgId = worker?.orgId;
      if (!orgId) {
        response.status(409).json({
          error: { code: 'brain_org_required', message: 'Agent must belong to an organization to use AI brain' },
        });
        return;
      }
      await assertStandardAgentCanQueryBrain(agentId, orgId);
      const { findBrainDocumentsForAgent } = await import('../aiBrain/brainFileStorage.js');
      const documents = await findBrainDocumentsForAgent({
        orgId,
        query: body.data.query,
        limit: body.data.limit,
      });
      response.json({ documents });
    } catch (e: unknown) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e instanceof BrainQueryForbiddenError) {
        response.status(403).json({ error: { code: e.code, message: e.message } });
        return;
      }
      if (e instanceof BrainNotProvisionedError) {
        response.status(409).json({ error: { code: e.code, message: e.message } });
        return;
      }
      if (e instanceof BrainWrongOrgError) {
        response.status(403).json({ error: { code: e.code, message: e.message } });
        return;
      }
      console.error('tools/brain/find-documents', e);
      response.status(500).json({ error: { code: 'brain_find_failed', message: 'Brain find failed' } });
    }
  });

  // Runner: poll for queued runs (authenticated by runner token)
  router.post('/:agentId/runs/poll', async (request: Request, response: Response) => {
    const parsed = pollBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid poll body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      await recoverStaleRuns(agentId);
      const run = await claimNextQueuedRun(agentId);
      if (!run) {
        // Mark idle polls so middleware can suppress noisy logs.
        response.locals.logHint = 'skip';
        response.json({ run: null });
        return;
      }
      const { takePrefetchedMemory } = await import('../gateway/memoryPrefetch.js');
      const prefetched = takePrefetchedMemory(run.id);
      const [agentRow, waConnector, memoryBlock, mcpServers] = await Promise.all([
        prisma.agent.findUnique({
          where: { id: agentId },
          select: {
            description: true,
            orgId: true,
            llmModel: true,
            reasoningEffort: true,
            toolProfile: true,
            permissionScopes: true,
            jitScopes: true,
            alwaysScopes: true,
          },
        }),
        prisma.connectorAccount.findFirst({
          where: { whatsappDefaultAgentId: agentId },
          select: { id: true },
        }),
        run.teamRunId
          ? Promise.resolve(null)
          : prefetched !== undefined
          ? Promise.resolve(prefetched)
          : buildMemoryBlock({
              agentId,
              userId: run.userId,
              conversationId: run.conversationId,
              currentPrompt: run.prompt,
            }).catch((err) => {
              console.error('[agent-memory] buildMemoryBlock failed', err instanceof Error ? err.message : err);
              return null;
            }),
        new McpRepository().runtimeServersForAgent(agentId).catch((err) => {
          console.error('[mcp] runtimeServersForAgent failed', err instanceof Error ? err.message : err);
          return [];
        }),
      ]);
      // Fall back to org-wide connector if no agent-specific one found
      const waConnectorResolved = waConnector ?? (
        agentRow?.orgId
          ? await prisma.connectorAccount.findFirst({
              where: { orgId: agentRow.orgId, provider: 'whatsapp_baileys' },
              select: { id: true },
            })
          : null
      );
      // Gateway MCP governance: drop tools whose scopes are org-disabled.
      let mcpServersFiltered = mcpServers as typeof mcpServers;
      if (agentRow?.orgId && Array.isArray(mcpServers) && mcpServers.length > 0) {
        const org = await prisma.organization.findUnique({
          where: { id: agentRow.orgId },
          select: { disabledScopes: true },
        });
        const disabled = org?.disabledScopes ?? [];
        if (disabled.length > 0) {
          mcpServersFiltered = mcpServers.map((server) => {
            const slug = String(server.slug ?? '');
            const tools = (server.tools ?? []).filter((t) => {
              const scope = `mcp.${slug}.${t.name}`;
              const wild = `mcp.${slug}.*`;
              return !disabled.includes(scope) && !disabled.includes(wild) && !disabled.includes('mcp.*');
            });
            return { ...server, tools };
          }) as typeof mcpServers;
        }
      }

      // Colleagues this agent may hand work to. Sent by name because the model picks targets by
      // name, and an id in a tool description is unusable to it.
      const askableAgents = await (async () => {
        const ids = askableAgentIds(agentRow?.permissionScopes ?? []);
        if (ids.length === 0) return [];
        const rows = await prisma.agent.findMany({
          where: { id: { in: ids }, status: { not: 'revoked' } },
          select: { id: true, name: true, description: true },
          orderBy: { name: 'asc' },
        });
        return rows.map((r) => ({ id: r.id, name: r.name, description: r.description ?? null }));
      })().catch((err) => {
        console.error('[poll] askableAgents failed', err);
        return [];
      });

      response.json({
        run: {
          id: run.id,
          prompt: run.prompt,
          attachments: run.attachments ?? null,
          skills: run.skills,
          askableAgents,
          // Fall back to the agent's configured model when the run didn't specify one,
          // so runs use the agent's chosen model instead of the runner's weak default.
          inferenceModel:
            run.inferenceModel ??
            (agentRow?.llmModel ? normalizeQlixInferenceModelId(agentRow.llmModel) : null),
          reasoningEffort: run.reasoningEffort ?? agentRow?.reasoningEffort ?? null,
          conversationId: run.conversationId,
          userId: run.userId,
          createdAt: run.createdAt.toISOString(),
          useBrain: run.useBrain,
          agentDescription: agentRow?.description ?? null,
          waConnectorId: waConnectorResolved?.id ?? null,
          memoryBlock: memoryBlock ?? null,
          mcpServers: mcpServersFiltered,
          toolProfile: agentRow?.toolProfile ?? 'full',
          // Live scopes so runners pick up post-create scope edits without a restart.
          permissionScopes: agentRow?.permissionScopes ?? [],
          jitScopes: agentRow?.jitScopes ?? [],
          alwaysScopes: agentRow?.alwaysScopes ?? [],
        },
      });
    } catch (e: any) {
      response.status(401).json({ error: { code: 'runner_unauthorized', message: e?.message ?? 'Unauthorized' } });
    }
  });

  // Runner: lightweight child run (Hermes-style delegate_task) without a Team.
  // Prefer spawn_subagents / await_subagents (nested in-process) for joinable fan-out.
  // This endpoint remains for fire-and-forget same-agent child runs only.
  router.post('/:agentId/runs/delegate', async (request: Request, response: Response) => {
    const schema = z.object({
      prompt: z.string().trim().min(1).max(8000),
      skills: z.array(z.string()).max(50).optional(),
      parentRunId: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'prompt required' } });
      return;
    }
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parent = parsed.data.parentRunId
        ? await prisma.agentRun.findUnique({
            where: { id: parsed.data.parentRunId },
            select: { conversationId: true, userId: true, orgId: true, agentId: true },
          })
        : null;
      if (parent && parent.agentId !== agentId) {
        response.status(404).json({ error: { code: 'not_found', message: 'Parent run not found' } });
        return;
      }
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { userId: true, orgId: true, name: true },
      });
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const userId = parent?.userId ?? agent.userId;
      const orgId = parent?.orgId ?? agent.orgId;
      let conversationId = parent?.conversationId ?? null;
      if (!conversationId) {
        const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
        conversationId = (
          await getOrCreatePrimaryConversation({ agentId, userId, orgId })
        ).id;
      }

      const turn = await gatewayService.handleInbound(
        buildWebChatInbound({
          agentId,
          conversationId,
          userId,
          orgId,
          body: parsed.data.prompt,
          skills: parsed.data.skills,
          agentName: agent.name,
          channel: inboundChannelFromRequest(request),
        }),
      );
      if (turn.status !== 'accepted') {
        response.status(409).json({
          error: {
            code: 'delegate_rejected',
            message: turn.status === 'rejected' ? turn.reason : turn.status,
          },
        });
        return;
      }
      response.status(201).json({ runId: turn.runId, messageId: turn.messageId, parentRunId: parsed.data.parentRunId ?? null });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      console.error('[delegate]', e);
      response.status(500).json({ error: { code: 'delegate_failed', message: 'Failed to delegate' } });
    }
  });

  // Runner-only: register logical sub-agent invocations under an active parent run (V1 nested).
  router.post('/:agentId/runs/:runId/subagents', async (request: Request, response: Response) => {
    const schema = z.object({
      tasks: z
        .array(
          z.object({
            prompt: z.string().trim().min(1).max(8000),
            skills: z.array(z.string().trim().min(1)).max(50).optional(),
            name: z.string().trim().min(1).max(120).optional().nullable(),
            /** V2: hand this task to a different agent (name or id). Omit for a nested child. */
            agent: z.string().trim().min(1).max(200).optional().nullable(),
          }),
        )
        .min(1)
        .max(32),
      depth: z.number().int().min(1).max(4).optional(),
      maxParallel: z.number().int().min(1).max(16).optional(),
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'tasks required' } });
      return;
    }
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const { SubAgentService, subAgentMaxParallel } = await import('../agents/subAgent.service.js');
      const svc = new SubAgentService();
      const { invocations, maxParallel } = await svc.createInvocations({
        agentId,
        parentRunId: runId,
        tasks: parsed.data.tasks.map((t) => ({
          prompt: t.prompt,
          skills: t.skills,
          name: t.name,
          agent: t.agent,
        })),
        depth: parsed.data.depth,
      });
      response.status(201).json({
        invocations,
        maxParallel: parsed.data.maxParallel
          ? Math.min(parsed.data.maxParallel, maxParallel)
          : maxParallel,
      });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      const code = e?.code as string | undefined;
      if (
        code === 'parent_run_not_found' ||
        code === 'parent_run_not_active' ||
        code === 'subagent_cap_exceeded' ||
        code === 'subagent_depth_exceeded' ||
        code === 'peer_not_found' ||
        code === 'peer_not_allowed' ||
        code === 'peer_self' ||
        code === 'peer_cycle' ||
        code === 'peer_chain_too_deep' ||
        code === 'not_found'
      ) {
        const status =
          code === 'parent_run_not_found' || code === 'peer_not_found' || code === 'not_found'
            ? 404
            : code === 'peer_not_allowed'
              ? 403
              : 409;
        response.status(status).json({ error: { code, message: e.message } });
        return;
      }
      console.error('[subagents.create]', e);
      response.status(500).json({ error: { code: 'subagent_create_failed', message: 'Failed to spawn sub-agents' } });
    }
  });

  router.get('/:agentId/runs/:runId/subagents', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const { SubAgentService } = await import('../agents/subAgent.service.js');
      const invocations = await new SubAgentService().listForParentRun(agentId, runId);
      response.json({ invocations });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e?.code === 'parent_run_not_found' || e?.code === 'parent_run_not_active') {
        response.status(e.code === 'parent_run_not_found' ? 404 : 409).json({
          error: { code: e.code, message: e.message },
        });
        return;
      }
      console.error('[subagents.list]', e);
      response.status(500).json({ error: { code: 'subagent_list_failed', message: 'Failed to list sub-agents' } });
    }
  });

  router.patch('/:agentId/subagents/:invocationId', async (request: Request, response: Response) => {
    const schema = z.object({
      status: z.enum(['running', 'completed', 'failed', 'canceled']),
      result: z.unknown().optional(),
      errorMessage: z.string().max(4000).optional().nullable(),
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'status required' } });
      return;
    }
    const agentId = String(request.params.agentId);
    const invocationId = String(request.params.invocationId);
    try {
      await assertRunnerAuth(agentId, request);
      const { SubAgentService } = await import('../agents/subAgent.service.js');
      const svc = new SubAgentService();
      if (parsed.data.status === 'running') {
        const invocation = await svc.markRunning(invocationId, agentId);
        response.json({ invocation });
        return;
      }
      const invocation = await svc.completeInvocation({
        invocationId,
        agentId,
        status: parsed.data.status,
        result: parsed.data.result,
        errorMessage: parsed.data.errorMessage,
      });
      response.json({ invocation });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e?.code === 'not_found') {
        response.status(404).json({ error: { code: 'not_found', message: e.message } });
        return;
      }
      console.error('[subagents.patch]', e);
      response.status(500).json({ error: { code: 'subagent_update_failed', message: 'Failed to update sub-agent' } });
    }
  });

  router.get('/:agentId/subagents/:invocationId', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    const invocationId = String(request.params.invocationId);
    try {
      await assertRunnerAuth(agentId, request);
      const { SubAgentService } = await import('../agents/subAgent.service.js');
      const invocation = await new SubAgentService().getInvocation(agentId, invocationId);
      response.json({ invocation });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e?.code === 'not_found') {
        response.status(404).json({ error: { code: 'not_found', message: e.message } });
        return;
      }
      console.error('[subagents.get]', e);
      response.status(500).json({ error: { code: 'subagent_get_failed', message: 'Failed to get sub-agent' } });
    }
  });

  // Runner: sync probed local OS paths into agent factual memory (hybrid only).
  router.post('/:agentId/local-environment', async (request: Request, response: Response) => {
    const parsed = runnerLocalEnvironmentBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid local environment body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { userId: true, orgId: true, runtime: true },
      });
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      if (agent.runtime !== 'hybrid' && agent.runtime !== 'local') {
        response.status(400).json({
          error: { code: 'invalid_runtime', message: 'Local environment sync is for hybrid/local agents only' },
        });
        return;
      }
      await storeRunnerLocalEnvironmentFacts({
        agentId,
        userId: agent.userId,
        orgId: agent.orgId,
        facts: parsed.data.facts,
        fingerprint: parsed.data.fingerprint,
      });
      response.json({ ok: true });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      console.error('[agent-memory] local-environment sync failed', e);
      response.status(500).json({ error: { code: 'local_environment_failed', message: 'Failed to store local environment' } });
    }
  });

  // Runner: optional compliance before/after_tool_call hook
  router.post('/:agentId/runs/:runId/compliance-hook', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const phase = typeof request.body?.phase === 'string' ? request.body.phase : '';
      const tool = typeof request.body?.tool === 'string' ? request.body.tool : '';
      // Soft policy: block only when org disabledScopes matches tool scope prefix.
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { orgId: true, permissionScopes: true },
      });
      let block = false;
      let reason: string | undefined;
      if (agent?.orgId && tool) {
        const org = await prisma.organization.findUnique({
          where: { id: agent.orgId },
          select: { disabledScopes: true },
        });
        const disabled = new Set(org?.disabledScopes ?? []);
        const maybeScope = tool.startsWith('mcp__')
          ? `mcp.${tool.split('__')[1] ?? ''}.*`
          : tool.includes('.')
            ? tool
            : null;
        if (maybeScope && [...disabled].some((d) => maybeScope.startsWith(d.replace(/\*$/, '')) || d === maybeScope)) {
          block = true;
          reason = `Tool blocked by org disabled scope policy (${maybeScope})`;
        }
      }
      void appendAgentRunEvent(runId, 'log', {
        message: 'compliance_hook',
        phase,
        tool,
        block,
        reason: reason ?? null,
      }).catch(() => undefined);
      response.json({ ok: true, block, reason });
    } catch (e: any) {
      response.status(401).json({ error: { code: 'runner_unauthorized', message: e?.message ?? 'Unauthorized' } });
    }
  });

  // Runner: drain user-injected messages for mid-run guidance (+ run status for cancel)
  router.get('/:agentId/runs/:runId/injections', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { agentId: true, status: true },
      });
      if (!run || run.agentId !== agentId) {
        response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
        return;
      }
      const messages = await drainInjections(runId);
      response.json({ messages, status: run.status });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      response.status(401).json({ error: { code: 'runner_unauthorized', message: e?.message ?? 'Unauthorized' } });
    }
  });

  // Runner: append run event (delta/log/status)
  router.post('/:agentId/runs/:runId/event', async (request: Request, response: Response) => {
    const parsed = runnerLogBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid event body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { agentId: true } });
      if (!run || run.agentId !== agentId) {
        response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
        return;
      }
      const seq = await appendAgentRunEvent(runId, parsed.data.type, parsed.data.data);
      response.json({ ok: true, seq });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        response.status(409).json({
          error: { code: 'event_seq_conflict', message: 'Run event sequence conflict; retry the event.' },
        });
        return;
      }
      console.error('[agent-run-event]', e);
      response.status(500).json({ error: { code: 'event_failed', message: 'Failed to record run event' } });
    }
  });

  // Runner: complete run
  router.post('/:agentId/runs/:runId/complete', async (request: Request, response: Response) => {
    const parsed = runnerCompleteBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid complete body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: {
          agentId: true,
          conversationId: true,
          userId: true,
          orgId: true,
          prompt: true,
          skills: true,
          status: true,
          teamRunId: true,
        },
      });
      if (!run || run.agentId !== agentId) {
        response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
        return;
      }

      // Stop from Active Runs wins — do not overwrite canceled with success/failed.
      if (run.status === 'canceled' || run.status === 'cancelled') {
        response.json({ ok: true, status: 'canceled', ignored: true });
        return;
      }

      // Fetch user email for billing exempt check
      const user = await prisma.user.findUnique({
        where: { id: run.userId },
        select: { email: true },
      });

      const finishedAt = new Date();
      await prisma.$transaction(async (tx) => {
        const updated = await tx.agentRun.updateMany({
          where: { id: runId, status: { notIn: ['canceled', 'cancelled'] } },
          data: {
            status: parsed.data.ok ? 'success' : 'failed',
            finishedAt,
            result: parsed.data.result as any,
            errorMessage: parsed.data.errorMessage ?? null,
          },
        });
        if (updated.count === 0) {
          return;
        }
        if (parsed.data.ok) {
          const content =
            typeof parsed.data.result === 'string'
              ? parsed.data.result
              : JSON.stringify(parsed.data.result ?? {}, null, 2);
          await tx.agentMessage.create({
            data: { conversationId: run.conversationId, role: 'agent', content },
          });
        } else {
          await tx.agentMessage.create({
            data: {
              conversationId: run.conversationId,
              role: 'system',
              content: `Run failed: ${parsed.data.errorMessage ?? 'unknown error'}`,
            },
          });
        }
      });

      const after = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (after?.status === 'canceled' || after?.status === 'cancelled') {
        response.json({ ok: true, status: 'canceled', ignored: true });
        return;
      }
      if (!parsed.data.ok) {
        console.warn(
          `[agent-run] failed runId=${runId} agentId=${agentId} error=${String(parsed.data.errorMessage ?? '').slice(0, 500)}`,
        );
      }

      // Unified channel delivery (WhatsApp / Slack / tracked targets).
      void replyDispatcher
        .deliver(runId, {
          ok: parsed.data.ok,
          result: parsed.data.result,
          errorMessage: parsed.data.errorMessage ?? null,
        })
        .catch((err) => {
          console.warn('[gateway] replyDispatcher.deliver', err instanceof Error ? err.message : err);
        });

      // Fire-and-forget: learn long-term memory (facts / episode / recipe) from this run.
      // Never allowed to affect the run outcome.
      const resultContent =
        typeof parsed.data.result === 'string'
          ? parsed.data.result
          : JSON.stringify(parsed.data.result ?? {}, null, 2);
      if (!run.teamRunId) {
        void extractAndStoreMemories({
          agentId,
          userId: run.userId,
          orgId: run.orgId,
          prompt: run.prompt,
          resultContent,
          ok: parsed.data.ok,
          skills: run.skills ?? [],
        }).catch((err) => {
          console.error('[agent-memory] extractAndStoreMemories', err instanceof Error ? err.message : err);
        });

        // Individual conversations retain their existing memory and compaction behavior.
        void updateConversationSummary(run.conversationId).catch((err) => {
          console.error('[agent-memory] updateConversationSummary', err instanceof Error ? err.message : err);
        });
      }

      // Fire-and-forget: record run usage and post-execution billing
      if (parsed.data.ok && user?.email) {
        void recordRunUsage(prisma, { runId, agentId, orgId: run.orgId, userId: run.userId }).catch((err) => {
          console.error('[record-run-usage]', err);
        });

        void recordSuccessfulEvent(prisma, {
          orgId: run.orgId!,
          userId: run.userId,
          email: user.email,
          agentId,
          eventType: 'agent_run',
          eventKey: `run:${runId}`,
        }).catch((err) => {
          console.error('[record-billing-event]', err);
        });
      }

      response.json({ ok: true });
    } catch (e: any) {
      response.status(401).json({ error: { code: 'runner_unauthorized', message: e?.message ?? 'Unauthorized' } });
    }
  });

  // UI: SSE stream for a run (polls AgentRunEvent rows)
  router.get(
    '/:agentId/runs/:runId/stream',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const runId = String(request.params.runId);
        await assertOwnsAgent(request, agentId);
        await streamAgentRunEvents(request, response, agentId, runId);
      } catch (err) {
        console.error('stream error', err);
        if (!response.headersSent) {
          response.status(500).json({ error: { code: 'stream_failed', message: 'Failed to stream run' } });
        }
      }
    },
  );

  // Hybrid runner: same SSE stream, authenticated with runner token.
  router.get('/:agentId/runner/runs/:runId/stream', async (request: Request, response: Response) => {
    try {
      const agentId = String(request.params.agentId);
      const runId = String(request.params.runId);
      await assertRunnerAuth(agentId, request);
      await streamAgentRunEvents(request, response, agentId, runId);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      console.error('runner stream error', err);
      if (!response.headersSent) {
        response.status(500).json({ error: { code: 'stream_failed', message: 'Failed to stream run' } });
      }
    }
  });

  // UI / gateway: mid-run steer (inject guidance into active run)
  router.post(
    '/:agentId/runs/:runId/inject',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (request: Request, response: Response) => {
      const schema = z.object({ message: z.string().trim().min(1).max(8000) });
      const parsed = schema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'message required' } });
        return;
      }
      try {
        const agentId = String(request.params.agentId);
        const runId = String(request.params.runId);
        await assertOwnsAgent(request, agentId);
        const run = await prisma.agentRun.findUnique({
          where: { id: runId },
          select: { id: true, agentId: true, status: true, conversationId: true },
        });
        if (!run || run.agentId !== agentId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
          return;
        }
        if (run.status === 'success' || run.status === 'failed' || run.status === 'canceled') {
          response.status(409).json({ error: { code: 'run_finished', message: 'Run already finished' } });
          return;
        }
        const { addInjection } = await import('../teams/runInjectionStore.js');
        await addInjection(runId, parsed.data.message);
        const seq = await appendAgentRunEvent(runId, 'log', {
          message: 'user_steer',
          text: parsed.data.message,
        });
        await prisma.agentMessage.create({
          data: {
            conversationId: run.conversationId,
            role: 'user',
            content: `[steer] ${parsed.data.message}`,
          },
        });
        response.json({ ok: true, seq });
      } catch (err) {
        console.error('inject error', err);
        response.status(500).json({ error: { code: 'inject_failed', message: 'Failed to inject' } });
      }
    },
  );

  // UI: Stop a running execution (propagates to hybrid runner + local_chat via SSE done)
  router.post(
    '/:agentId/runs/:runId/stop',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const runId = String(request.params.runId);
        await assertOwnsAgent(request, agentId);

        const run = await prisma.agentRun.findUnique({
          where: { id: runId },
          select: { id: true, agentId: true, status: true },
        });
        if (!run || run.agentId !== agentId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
          return;
        }

        const alreadyTerminal = RUN_TERMINAL_STATUSES.has(run.status);
        if (!alreadyTerminal) {
          await cancelAgentRun(runId, 'Stopped by user');
        }

        response.json({ ok: true, message: 'Run stopped', status: 'canceled' });
      } catch (err) {
        console.error('stop run error', err);
        response.status(500).json({ error: { code: 'stop_failed', message: 'Failed to stop run' } });
      }
    },
  );

  // Runner: Orbit social tools (channels / posts / analytics / publish)
  router.post('/:agentId/tools/social/channels', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = socialChannelsBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid social channels payload' } });
        return;
      }
      const result = await executeSocialChannels({ agentId, runId: parsed.data.runId ?? null });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof SocialScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof OrbitConnectorNotConfiguredError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('social/channels', err);
      response.status(500).json({
        error: { code: 'social_channels_failed', message: err instanceof SocialToolError ? err.message : 'Failed' },
      });
    }
  });

  router.post('/:agentId/tools/social/posts/list', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = socialPostsListBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid social posts list payload' } });
        return;
      }
      const result = await executeSocialPostsList({
        agentId,
        runId: parsed.data.runId ?? null,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof SocialScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof OrbitConnectorNotConfiguredError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('social/posts/list', err);
      response.status(500).json({
        error: { code: 'social_posts_list_failed', message: err instanceof SocialToolError ? err.message : 'Failed' },
      });
    }
  });

  router.post('/:agentId/tools/social/analytics', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = socialAnalyticsBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'integrationId is required' } });
        return;
      }
      const result = await executeSocialAnalytics({
        agentId,
        runId: parsed.data.runId ?? null,
        integrationId: parsed.data.integrationId,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof SocialScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof OrbitConnectorNotConfiguredError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('social/analytics', err);
      response.status(500).json({
        error: { code: 'social_analytics_failed', message: err instanceof SocialToolError ? err.message : 'Failed' },
      });
    }
  });

  router.post('/:agentId/tools/social/publish', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = socialPublishBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'payload is required' } });
        return;
      }
      const result = await executeSocialPublish({
        agentId,
        runId: parsed.data.runId ?? null,
        payload: parsed.data.payload,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof SocialScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof JitTokenRequiredError || err instanceof JitTokenInvalidError) {
        response.status(403).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
        return;
      }
      if (err instanceof OrbitConnectorNotConfiguredError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('social/publish', err);
      response.status(500).json({
        error: { code: 'social_publish_failed', message: err instanceof SocialToolError ? err.message : 'Failed' },
      });
    }
  });

  // Runner: email.read tool proxy (scoped + audited, forwards to n8n)
  router.post('/:agentId/tools/email/read', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = emailReadBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid email read payload' } });
        return;
      }
      const result = await executeEmailRead({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof EmailScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof EmailProviderSelectionRequiredError) {
        response.status(409).json({ error: { code: err.code, message: err.message, providers: err.providers } });
        return;
      }
      if (err instanceof EmailProviderNotAvailableError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof ConnectorNotConfiguredError || err instanceof N8nNotConfiguredError) {
        response.status(409).json({
          error: {
            code: (err as Error & { code: string }).code,
            message: err.message,
            ...(err instanceof ConnectorNotConfiguredError
              ? { connectInstructions: GMAIL_CONNECT_INSTRUCTIONS }
              : {}),
          },
        });
        return;
      }
      console.error('email/read', err);
      response.status(500).json({
        error: { code: 'email_read_failed', message: err instanceof EmailToolError ? err.message : 'Email read failed' },
      });
    }
  });

  // Runner: email.send tool proxy (JIT + audited, forwards to n8n)
  router.post('/:agentId/tools/email/send', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = emailSendBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        const issueSummary = parsed.error.issues
          .slice(0, 6)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        response.status(400).json({
          error: {
            code: 'invalid_body',
            message: issueSummary
              ? `Invalid email send payload (${issueSummary})`
              : 'Invalid email send payload',
            issues: parsed.error.issues,
          },
        });
        return;
      }
      const result = await executeEmailSend({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof EmailScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof EmailProviderSelectionRequiredError) {
        response.status(409).json({ error: { code: err.code, message: err.message, providers: err.providers } });
        return;
      }
      if (err instanceof EmailProviderNotAvailableError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof JitTokenRequiredError || err instanceof JitTokenInvalidError) {
        response.status(403).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
        return;
      }
      if (err instanceof ConnectorNotConfiguredError || err instanceof N8nNotConfiguredError) {
        response.status(409).json({
          error: {
            code: (err as Error & { code: string }).code,
            message: err.message,
            ...(err instanceof ConnectorNotConfiguredError
              ? { connectInstructions: GMAIL_CONNECT_INSTRUCTIONS }
              : {}),
          },
        });
        return;
      }
      if (err instanceof EmailComposeScopeMissingError) {
        response.status(409).json({
          error: {
            code: err.code,
            message: err.message,
            connectInstructions: GMAIL_RECONNECT_FOR_DRAFT_INSTRUCTIONS,
          },
        });
        return;
      }
      console.error('email/send', err);
      response.status(500).json({
        error: { code: 'email_send_failed', message: err instanceof EmailToolError ? err.message : 'Email send failed' },
      });
    }
  });

  const respondGoogleToolError = (
    response: Response,
    err: unknown,
    failedCode: string,
    connectInstructions: string,
  ): boolean => {
    if (err instanceof RunnerUnauthorizedError) {
      response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
      return true;
    }
    if (
      err instanceof DriveScopeDeniedError ||
      err instanceof DocsScopeDeniedError ||
      err instanceof SheetsScopeDeniedError ||
      err instanceof SlidesScopeDeniedError ||
      err instanceof FormsScopeDeniedError ||
      err instanceof CalendarScopeDeniedError ||
      err instanceof MeetScopeDeniedError
    ) {
      response.status(403).json({ error: { code: err.code, message: err.message } });
      return true;
    }
    if (err instanceof DriveProviderSelectionRequiredError) {
      response.status(409).json({
        error: { code: err.code, message: err.message, providers: err.providers },
      });
      return true;
    }
    if (err instanceof DriveProviderNotAvailableError) {
      response.status(409).json({ error: { code: err.code, message: err.message } });
      return true;
    }
    if (err instanceof JitTokenRequiredError || err instanceof JitTokenInvalidError) {
      response.status(403).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
      return true;
    }
    if (
      err instanceof DriveConnectorNotConfiguredError ||
      err instanceof DocsConnectorNotConfiguredError ||
      err instanceof SheetsConnectorNotConfiguredError ||
      err instanceof SlidesConnectorNotConfiguredError ||
      err instanceof FormsConnectorNotConfiguredError ||
      err instanceof CalendarConnectorNotConfiguredError ||
      err instanceof MeetConnectorNotConfiguredError
    ) {
      response.status(409).json({
        error: {
          code: (err as Error & { code: string }).code,
          message: err.message,
          connectInstructions,
        },
      });
      return true;
    }
    if (
      err instanceof DriveToolError ||
      err instanceof DocsToolError ||
      err instanceof SheetsToolError ||
      err instanceof SlidesToolError ||
      err instanceof FormsToolError ||
      err instanceof CalendarToolError ||
      err instanceof MeetToolError
    ) {
      response.status(500).json({ error: { code: failedCode, message: err.message } });
      return true;
    }
    return false;
  };

  router.post('/:agentId/tools/drive/read', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = driveReadBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid drive read payload' } });
        return;
      }
      const result = await executeDriveRead({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'drive_read_failed', DRIVE_CONNECT_INSTRUCTIONS)) return;
      console.error('drive/read', err);
      response.status(500).json({ error: { code: 'drive_read_failed', message: 'Drive read failed' } });
    }
  });

  router.post('/:agentId/tools/drive/write', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = driveWriteBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid drive write payload' } });
        return;
      }
      const result = await executeDriveWrite({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'drive_write_failed', DRIVE_CONNECT_INSTRUCTIONS)) return;
      console.error('drive/write', err);
      response.status(500).json({ error: { code: 'drive_write_failed', message: 'Drive write failed' } });
    }
  });

  router.post('/:agentId/tools/docs/read', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = docsReadBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid docs read payload' } });
        return;
      }
      const result = await executeDocsRead({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'docs_read_failed', DOCS_CONNECT_INSTRUCTIONS)) return;
      console.error('docs/read', err);
      response.status(500).json({ error: { code: 'docs_read_failed', message: 'Docs read failed' } });
    }
  });

  router.post('/:agentId/tools/docs/write', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = docsWriteBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid docs write payload' } });
        return;
      }
      const result = await executeDocsWrite({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'docs_write_failed', DOCS_CONNECT_INSTRUCTIONS)) return;
      console.error('docs/write', err);
      response.status(500).json({ error: { code: 'docs_write_failed', message: 'Docs write failed' } });
    }
  });

  router.post('/:agentId/tools/sheets/read', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = sheetsReadBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid sheets read payload' } });
        return;
      }
      const result = await executeSheetsRead({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'sheets_read_failed', SHEETS_CONNECT_INSTRUCTIONS)) return;
      console.error('sheets/read', err);
      response.status(500).json({ error: { code: 'sheets_read_failed', message: 'Sheets read failed' } });
    }
  });

  router.post('/:agentId/tools/sheets/write', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = sheetsWriteBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid sheets write payload' } });
        return;
      }
      const result = await executeSheetsWrite({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'sheets_write_failed', SHEETS_CONNECT_INSTRUCTIONS)) return;
      console.error('sheets/write', err);
      response.status(500).json({ error: { code: 'sheets_write_failed', message: 'Sheets write failed' } });
    }
  });

  router.post('/:agentId/tools/slides/read', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = slidesReadBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid slides read payload' } });
        return;
      }
      const result = await executeSlidesRead({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'slides_read_failed', SLIDES_CONNECT_INSTRUCTIONS)) return;
      console.error('slides/read', err);
      response.status(500).json({ error: { code: 'slides_read_failed', message: 'Slides read failed' } });
    }
  });

  router.post('/:agentId/tools/slides/write', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = slidesWriteBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid slides write payload' } });
        return;
      }
      const result = await executeSlidesWrite({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'slides_write_failed', SLIDES_CONNECT_INSTRUCTIONS)) return;
      console.error('slides/write', err);
      response.status(500).json({ error: { code: 'slides_write_failed', message: 'Slides write failed' } });
    }
  });

  router.post('/:agentId/tools/forms/read', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = formsReadBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid forms read payload' } });
        return;
      }
      const result = await executeFormsRead({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'forms_read_failed', FORMS_CONNECT_INSTRUCTIONS)) return;
      console.error('forms/read', err);
      response.status(500).json({ error: { code: 'forms_read_failed', message: 'Forms read failed' } });
    }
  });

  router.post('/:agentId/tools/forms/write', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = formsWriteBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid forms write payload' } });
        return;
      }
      const result = await executeFormsWrite({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'forms_write_failed', FORMS_CONNECT_INSTRUCTIONS)) return;
      console.error('forms/write', err);
      response.status(500).json({ error: { code: 'forms_write_failed', message: 'Forms write failed' } });
    }
  });

  router.post('/:agentId/tools/calendar/read', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = calendarReadBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid calendar read payload' } });
        return;
      }
      const result = await executeCalendarRead({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'calendar_read_failed', CALENDAR_CONNECT_INSTRUCTIONS)) return;
      console.error('calendar/read', err);
      response.status(500).json({ error: { code: 'calendar_read_failed', message: 'Calendar read failed' } });
    }
  });

  router.post('/:agentId/tools/calendar/write', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = calendarWriteBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid calendar write payload' } });
        return;
      }
      const result = await executeCalendarWrite({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'calendar_write_failed', CALENDAR_CONNECT_INSTRUCTIONS)) return;
      console.error('calendar/write', err);
      response.status(500).json({ error: { code: 'calendar_write_failed', message: 'Calendar write failed' } });
    }
  });

  router.post('/:agentId/tools/meet/manage', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = meetManageBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid meet manage payload' } });
        return;
      }
      const result = await executeMeetManage({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (respondGoogleToolError(response, err, 'meet_manage_failed', MEET_CONNECT_INSTRUCTIONS)) return;
      console.error('meet/manage', err);
      response.status(500).json({ error: { code: 'meet_manage_failed', message: 'Meet manage failed' } });
    }
  });

  router.post('/:agentId/tools/whatsapp/list-contacts', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappListContactsBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid WhatsApp contacts payload' } });
        return;
      }
      const result = await executeWhatsAppListContacts({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof WhatsAppScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof WhatsAppNotLinkedError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('whatsapp/list-contacts', err);
      response.status(500).json({
        error: {
          code: 'whatsapp_list_contacts_failed',
          message: err instanceof WhatsAppToolError ? err.message : 'WhatsApp list contacts failed',
        },
      });
    }
  });

  router.post('/:agentId/tools/whatsapp/read-chat', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappReadChatBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid WhatsApp read-chat payload' } });
        return;
      }
      const result = await executeWhatsAppReadChat({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof WhatsAppScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof WhatsAppNotLinkedError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('whatsapp/read-chat', err);
      response.status(500).json({
        error: {
          code: 'whatsapp_read_chat_failed',
          message: err instanceof WhatsAppToolError ? err.message : 'WhatsApp read chat failed',
        },
      });
    }
  });

  router.post('/:agentId/tools/whatsapp/send-message', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappContactSendBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid WhatsApp send-message payload' } });
        return;
      }
      const result = await executeWhatsAppContactSend({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof WhatsAppScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof JitTokenRequiredError || err instanceof JitTokenInvalidError) {
        response.status(403).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
        return;
      }
      if (err instanceof WhatsAppNotLinkedError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof TeamOutboundProvenanceError) {
        response.status(422).json({
          error: { code: err.code, message: err.message, retryable: false },
        });
        return;
      }
      console.error('whatsapp/send-message', err);
      response.status(500).json({
        error: {
          code: 'whatsapp_send_message_failed',
          message: err instanceof WhatsAppToolError ? err.message : 'WhatsApp send message failed',
        },
      });
    }
  });

  router.post('/:agentId/tools/whatsapp/send-poll', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappPollSendBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid WhatsApp send-poll payload' } });
        return;
      }
      const result = await executeWhatsAppPollSend({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof WhatsAppScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof JitTokenRequiredError || err instanceof JitTokenInvalidError) {
        response.status(403).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
        return;
      }
      if (err instanceof WhatsAppNotLinkedError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof TeamOutboundProvenanceError) {
        response.status(422).json({
          error: { code: err.code, message: err.message, retryable: false },
        });
        return;
      }
      console.error('whatsapp/send-poll', err);
      response.status(500).json({
        error: {
          code: 'whatsapp_send_poll_failed',
          message: err instanceof WhatsAppToolError ? err.message : 'WhatsApp send poll failed',
        },
      });
    }
  });

  router.post('/:agentId/tools/whatsapp/send-document-to', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappContactDocumentSendBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({
          error: { code: 'invalid_body', message: 'Invalid WhatsApp send-document-to payload' },
        });
        return;
      }
      const result = await executeWhatsAppDocumentSend({
        agentId,
        runId: parsed.data.runId ?? null,
        input: {
          recipient: parsed.data.recipient,
          fileName: parsed.data.file_name,
          contentBase64: parsed.data.content_base64,
          brainDocumentId: parsed.data.brain_document_id,
          mimetype: parsed.data.mimetype,
          jitToken: parsed.data.jitToken,
          replyInstructions: parsed.data.replyInstructions,
        },
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof WhatsAppScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof JitTokenRequiredError || err instanceof JitTokenInvalidError) {
        response.status(403).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
        return;
      }
      if (err instanceof WhatsAppNotLinkedError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof TeamOutboundProvenanceError) {
        response.status(422).json({
          error: { code: err.code, message: err.message, retryable: false },
        });
        return;
      }
      console.error('whatsapp/send-document-to', err);
      response.status(500).json({
        error: {
          code: 'whatsapp_send_document_failed',
          message: err instanceof WhatsAppToolError ? err.message : 'WhatsApp send document failed',
        },
      });
    }
  });

  router.post('/:agentId/tools/whatsapp/auto-reply/status', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappAutoReplyStatusBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid payload' } });
        return;
      }
      const result = await executeWhatsAppAutoReplyStatus({
        agentId,
        runId: parsed.data.runId ?? null,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof WhatsAppScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('whatsapp/auto-reply/status', err);
      response.status(500).json({
        error: {
          code: 'whatsapp_auto_reply_status_failed',
          message: err instanceof WhatsAppToolError ? err.message : 'Auto-reply status failed',
        },
      });
    }
  });

  router.post('/:agentId/tools/whatsapp/auto-reply/stop', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappAutoReplyStopBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid payload' } });
        return;
      }
      const result = await executeWhatsAppAutoReplyStop({
        agentId,
        runId: parsed.data.runId ?? null,
        input: { recipient: parsed.data.recipient },
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof WhatsAppScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('whatsapp/auto-reply/stop', err);
      response.status(500).json({
        error: {
          code: 'whatsapp_auto_reply_stop_failed',
          message: err instanceof WhatsAppToolError ? err.message : 'Auto-reply stop failed',
        },
      });
    }
  });

  router.post(
    '/:agentId/tools/whatsapp/auto-reply/set-instructions',
    async (request: Request, response: Response) => {
      const agentId = String(request.params.agentId);
      try {
        await assertRunnerAuth(agentId, request);
        const parsed = whatsappAutoReplyInstructionsBody.safeParse(request.body ?? {});
        if (!parsed.success) {
          response.status(400).json({
            error: { code: 'invalid_body', message: 'recipient and instructions required' },
          });
          return;
        }
        const result = await executeWhatsAppAutoReplySetInstructions({
          agentId,
          runId: parsed.data.runId ?? null,
          input: {
            recipient: parsed.data.recipient,
            instructions: parsed.data.instructions,
          },
        });
        response.json(result);
      } catch (err) {
        if (err instanceof RunnerUnauthorizedError) {
          response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
          return;
        }
        if (err instanceof WhatsAppScopeDeniedError) {
          response.status(403).json({ error: { code: err.code, message: err.message } });
          return;
        }
        if (err instanceof WhatsAppNotLinkedError) {
          response.status(409).json({ error: { code: err.code, message: err.message } });
          return;
        }
        console.error('whatsapp/auto-reply/set-instructions', err);
        response.status(500).json({
          error: {
            code: 'whatsapp_auto_reply_instructions_failed',
            message:
              err instanceof WhatsAppToolError ? err.message : 'Set reply instructions failed',
          },
        });
      }
    },
  );

  registerCrmToolRoutes(router);
  registerNotionToolRoutes(router);
  registerSlackToolRoutes(router);

  const jitService = new JitService();
  const runnerJitRequestBody = z.object({
    actionType: z.string().trim().min(1).max(255),
    payload: z.record(z.string(), z.unknown()),
  });

  router.post('/:agentId/jit/request', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = runnerJitRequestBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({
          error: { code: 'invalid_body', message: 'Invalid JIT request', issues: parsed.error.issues },
        });
        return;
      }
      const result = await jitService.requestFromRunner({
        agentId,
        actionType: parsed.data.actionType,
        payload: parsed.data.payload,
      });
      response.status(201).json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof AgentNotFoundError) {
        response.status(404).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof NotJitScopeError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('[jit] runner request', err);
      response.status(500).json({ error: { code: 'jit_request_failed', message: 'Failed to create JIT request' } });
    }
  });

  // Runner: send a local document (e.g. a generated PDF) to the agent's linked WhatsApp.
  router.post('/:agentId/tools/whatsapp/send-document', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappSendDocumentBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'file_path is required' } });
        return;
      }
      const result = await deliverWhatsAppDocumentForAgent(agentId, parsed.data.file_path, parsed.data.file_name);
      if (!result.ok) {
        response.status(result.status).json({ error: { code: result.code, message: result.message } });
        return;
      }
      response.json({ ok: true, fileName: result.fileName });
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      console.error('whatsapp/send-document', err);
      response.status(500).json({
        error: { code: 'whatsapp_send_failed', message: 'WhatsApp document send failed' },
      });
    }
  });

  // Runner (cloud): upload file bytes (base64) for WhatsApp delivery. Cloud runners
  // can't pass a file_path the WhatsApp service can read, so the bytes are staged to
  // a backend temp file and cleaned up after the send.
  router.post('/:agentId/tools/whatsapp/send-file', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    let tmpPath: string | null = null;
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappSendFileBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'file_name and content_base64 are required' } });
        return;
      }
      const buffer = Buffer.from(parsed.data.content_base64, 'base64');
      if (buffer.length === 0) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'content_base64 decoded to empty file' } });
        return;
      }
      const { resolveWhatsAppDocumentIdentity } = await import('../whatsapp/documentFileIdentity.js');
      const identity = resolveWhatsAppDocumentIdentity({
        fileName: parsed.data.file_name,
        bytes: buffer,
        mimetype: parsed.data.mimetype,
      });
      tmpPath = join(tmpdir(), `qlix-wa-${randomUUID()}-${identity.fileName}`);
      await writeFile(tmpPath, buffer);

      const result = await deliverWhatsAppDocumentForAgent(
        agentId,
        tmpPath,
        identity.fileName,
        identity.mimetype,
      );
      if (!result.ok) {
        response.status(result.status).json({ error: { code: result.code, message: result.message } });
        return;
      }
      response.json({ ok: true, fileName: result.fileName });
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      console.error('whatsapp/send-file', err);
      response.status(500).json({
        error: { code: 'whatsapp_send_failed', message: 'WhatsApp file send failed' },
      });
    } finally {
      if (tmpPath) {
        await unlink(tmpPath).catch(() => {
          /* best-effort cleanup */
        });
      }
    }
  });

  // Runner (cloud): upload a generated file (PDF, spreadsheet, etc.) to the sandbox store
  // and get back a browser-facing download link the agent can share in chat.
  router.post(
    '/:agentId/runs/:runId/sandbox-file',
    raw({ type: () => true, limit: '60mb' }),
    async (request: Request, response: Response) => {
      const agentId = String(request.params.agentId);
      try {
        await storeRunnerSandboxUpload(request, response, agentId, 'download.bin', 'application/octet-stream');
      } catch (err) {
        console.error('runs/sandbox-file', err);
        response.status(502).json({ error: { code: 'sandbox_upload_failed', message: 'Could not create download link' } });
      }
    },
  );

  // Backward-compatible alias for PDF uploads (delegates to the same sandbox store).
  router.post(
    '/:agentId/runs/:runId/report-pdf',
    raw({ type: () => true, limit: '60mb' }),
    async (request: Request, response: Response) => {
      const agentId = String(request.params.agentId);
      try {
        await storeRunnerSandboxUpload(request, response, agentId, 'report.pdf', 'application/pdf');
      } catch (err) {
        console.error('runs/report-pdf', err);
        response.status(502).json({ error: { code: 'sandbox_upload_failed', message: 'Could not create download link' } });
      }
    },
  );

  return router;
}
