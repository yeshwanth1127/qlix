import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { assertRunnerAuth, RunnerUnauthorizedError } from '../agentChat/runnerAuth.js';
import { JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import { ConnectorNotConfiguredError } from '../connectors/emailTool.service.js';
import {
  CRM_CONNECT_INSTRUCTIONS,
  CrmScopeDeniedError,
  executeCrmAddNote,
  executeCrmBulkCreate,
  executeCrmBulkUpdate,
  executeCrmConvertLead,
  executeCrmDelete,
  executeCrmDescribeModule,
  executeCrmDownloadAttachment,
  executeCrmGet,
  executeCrmLink,
  executeCrmListAttachments,
  executeCrmListModules,
  executeCrmQuery,
  executeCrmSearch,
  executeCrmCreate,
  executeCrmUnlink,
  executeCrmUpdate,
  executeCrmUploadAttachment,
} from '../connectors/crmTool.service.js';

const runIdField = z.string().trim().min(1).max(80).optional();
const moduleField = z.string().trim().min(1).max(80);
const recordIdField = z.string().trim().min(1).max(80);
const jitField = z.string().trim().min(8).max(512).nullable().optional();
const fieldsRecord = z.record(z.string(), z.unknown());

function crmError(response: Response, err: unknown, tool: string, failedCode: string): void {
  if (err instanceof RunnerUnauthorizedError) {
    response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
    return;
  }
  if (err instanceof CrmScopeDeniedError) {
    response.status(403).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof JitTokenRequiredError || err instanceof JitTokenInvalidError) {
    response.status(403).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
    return;
  }
  if (err instanceof ConnectorNotConfiguredError) {
    response.status(409).json({
      error: {
        code: err.code,
        message: err.message,
        connectInstructions: CRM_CONNECT_INSTRUCTIONS,
      },
    });
    return;
  }
  console.error(tool, err);
  const message =
    err instanceof Error && err.message.trim() ?
      err.message
    : `${tool} failed`;
  response.status(500).json({
    error: {
      code: failedCode,
      message,
    },
  });
}

export function registerCrmToolRoutes(router: Router): void {
  router.post('/:agentId/tools/crm/modules', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const body = z.object({ runId: runIdField }).safeParse(request.body ?? {});
      const result = await executeCrmListModules({ agentId, runId: body.success ? body.data.runId ?? null : null });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/modules', 'crm_modules_failed');
    }
  });

  router.post('/:agentId/tools/crm/describe', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z.object({ runId: runIdField, module: moduleField }).safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid describe payload' } });
        return;
      }
      const result = await executeCrmDescribeModule({
        agentId,
        runId: parsed.data.runId ?? null,
        module: parsed.data.module,
      });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/describe', 'crm_describe_failed');
    }
  });

  router.post('/:agentId/tools/crm/query', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({ runId: runIdField, query: z.string().trim().min(1).max(4000) })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid query payload' } });
        return;
      }
      const result = await executeCrmQuery({
        agentId,
        runId: parsed.data.runId ?? null,
        query: parsed.data.query,
      });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/query', 'crm_query_failed');
    }
  });

  router.post('/:agentId/tools/crm/search', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          word: z.string().trim().max(200).optional(),
          fields: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
          page: z.number().int().min(1).max(100).optional(),
          perPage: z.number().int().min(1).max(50).optional(),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid search payload' } });
        return;
      }
      const result = await executeCrmSearch({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/search', 'crm_search_failed');
    }
  });

  router.post('/:agentId/tools/crm/get', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          recordId: recordIdField,
          fields: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid get payload' } });
        return;
      }
      const result = await executeCrmGet({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/get', 'crm_get_failed');
    }
  });

  router.post('/:agentId/tools/crm/create', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({ runId: runIdField, module: moduleField, fields: fieldsRecord, jitToken: jitField })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid create payload' } });
        return;
      }
      const result = await executeCrmCreate({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/create', 'crm_create_failed');
    }
  });

  router.post('/:agentId/tools/crm/update', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          recordId: recordIdField,
          fields: fieldsRecord,
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid update payload' } });
        return;
      }
      const result = await executeCrmUpdate({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/update', 'crm_update_failed');
    }
  });

  router.post('/:agentId/tools/crm/delete', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({ runId: runIdField, module: moduleField, recordId: recordIdField, jitToken: jitField })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid delete payload' } });
        return;
      }
      const result = await executeCrmDelete({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/delete', 'crm_delete_failed');
    }
  });

  router.post('/:agentId/tools/crm/bulk-create', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          records: z.array(fieldsRecord).min(1).max(500),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid bulk create payload' } });
        return;
      }
      const result = await executeCrmBulkCreate({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/bulk-create', 'crm_bulk_create_failed');
    }
  });

  router.post('/:agentId/tools/crm/bulk-update', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          records: z.array(fieldsRecord).min(1).max(500),
          recordIds: z.array(recordIdField).optional(),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid bulk update payload' } });
        return;
      }
      const result = await executeCrmBulkUpdate({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/bulk-update', 'crm_bulk_update_failed');
    }
  });

  router.post('/:agentId/tools/crm/convert-lead', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          leadId: recordIdField,
          dealName: z.string().trim().max(200).optional(),
          accountName: z.string().trim().max(200).optional(),
          contactRole: z.string().trim().max(120).optional(),
          overwrite: z.boolean().optional(),
          notifyLeadOwner: z.boolean().optional(),
          assignTo: z.string().trim().max(80).optional(),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid convert payload' } });
        return;
      }
      const result = await executeCrmConvertLead({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/convert-lead', 'crm_convert_failed');
    }
  });

  router.post('/:agentId/tools/crm/link', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          recordId: recordIdField,
          relatedModule: moduleField,
          relatedRecordId: recordIdField,
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid link payload' } });
        return;
      }
      const result = await executeCrmLink({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/link', 'crm_link_failed');
    }
  });

  router.post('/:agentId/tools/crm/unlink', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          recordId: recordIdField,
          relatedModule: moduleField,
          relatedRecordId: recordIdField,
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid unlink payload' } });
        return;
      }
      const result = await executeCrmUnlink({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/unlink', 'crm_unlink_failed');
    }
  });

  router.post('/:agentId/tools/crm/attachments/list', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({ runId: runIdField, module: moduleField, recordId: recordIdField })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid attachments list payload' } });
        return;
      }
      const result = await executeCrmListAttachments({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/attachments/list', 'crm_attachments_list_failed');
    }
  });

  router.post('/:agentId/tools/crm/attachments/upload', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          recordId: recordIdField,
          fileName: z.string().trim().min(1).max(255),
          fileBase64: z.string().trim().min(1).max(15_000_000),
          mimeType: z.string().trim().max(120).optional(),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid attachment upload payload' } });
        return;
      }
      const result = await executeCrmUploadAttachment({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/attachments/upload', 'crm_attachment_upload_failed');
    }
  });

  router.post('/:agentId/tools/crm/attachments/download', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          recordId: recordIdField,
          attachmentId: recordIdField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid attachment download payload' } });
        return;
      }
      const result = await executeCrmDownloadAttachment({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/attachments/download', 'crm_attachment_download_failed');
    }
  });

  router.post('/:agentId/tools/crm/add-note', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          module: moduleField,
          recordId: recordIdField,
          title: z.string().trim().max(200).optional(),
          content: z.string().trim().min(1).max(20_000),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid add-note payload' } });
        return;
      }
      const result = await executeCrmAddNote({ agentId, runId: parsed.data.runId ?? null, input: parsed.data });
      response.json(result);
    } catch (err) {
      crmError(response, err, 'crm/add-note', 'crm_add_note_failed');
    }
  });
}
