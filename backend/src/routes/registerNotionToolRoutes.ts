import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { assertRunnerAuth, RunnerUnauthorizedError } from '../agentChat/runnerAuth.js';
import { JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import { ConnectorNotConfiguredError } from '../connectors/emailTool.service.js';
import {
  NOTION_CONNECT_INSTRUCTIONS,
  NotionScopeDeniedError,
  NotionToolError,
  executeNotionRead,
  executeNotionWrite,
} from '../connectors/notionTool.service.js';

const runIdField = z.string().trim().min(1).max(80).optional();
const jitField = z.string().trim().min(8).max(512).nullable().optional();

const notionReadBody = z.object({
  runId: runIdField,
  action: z.enum(['search', 'get_page', 'query_database']),
  query: z.string().trim().max(500).optional(),
  filter: z.enum(['page', 'database']).optional(),
  pageId: z.string().trim().max(80).optional(),
  databaseId: z.string().trim().max(80).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  startCursor: z.string().trim().max(2000).nullable().optional(),
  filterJson: z.record(z.string(), z.unknown()).nullable().optional(),
  sorts: z.array(z.unknown()).max(20).nullable().optional(),
});

const notionWriteBody = z.object({
  runId: runIdField,
  action: z.enum(['create_page', 'update_page', 'create_database_row']),
  pageId: z.string().trim().max(80).optional(),
  parentPageId: z.string().trim().max(80).optional(),
  parentDatabaseId: z.string().trim().max(80).optional(),
  databaseId: z.string().trim().max(80).optional(),
  title: z.string().trim().max(500).optional(),
  contentMarkdown: z.string().max(100_000).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  jitToken: jitField,
});

function notionError(response: Response, err: unknown, tool: string, failedCode: string): void {
  if (err instanceof RunnerUnauthorizedError) {
    response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
    return;
  }
  if (err instanceof NotionScopeDeniedError) {
    response.status(403).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof JitTokenRequiredError || err instanceof JitTokenInvalidError) {
    response.status(403).json({
      error: { code: (err as Error & { code: string }).code, message: err.message },
    });
    return;
  }
  if (err instanceof ConnectorNotConfiguredError) {
    response.status(409).json({
      error: {
        code: err.code,
        message: err.message,
        connectInstructions: NOTION_CONNECT_INSTRUCTIONS,
      },
    });
    return;
  }
  console.error(tool, err);
  const message =
    err instanceof NotionToolError || (err instanceof Error && err.message.trim())
      ? (err as Error).message
      : `${tool} failed`;
  response.status(500).json({ error: { code: failedCode, message } });
}

export function registerNotionToolRoutes(router: Router): void {
  router.post('/:agentId/tools/notion/read', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = notionReadBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid notion read payload' } });
        return;
      }
      const result = await executeNotionRead({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      notionError(response, err, 'notion/read', 'notion_read_failed');
    }
  });

  router.post('/:agentId/tools/notion/write', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = notionWriteBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid notion write payload' } });
        return;
      }
      const result = await executeNotionWrite({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      notionError(response, err, 'notion/write', 'notion_write_failed');
    }
  });
}
