import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { assertRunnerAuth, RunnerUnauthorizedError } from '../agentChat/runnerAuth.js';
import { JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import { ConnectorNotConfiguredError } from '../connectors/emailTool.service.js';
import { SlackApiError } from '../connectors/slackApi.service.js';
import {
  executeSlackCreateChannel,
  executeSlackCreateListItem,
  executeSlackDeleteListItem,
  executeSlackDescribeList,
  executeSlackFindChannelLists,
  executeSlackGetHistory,
  executeSlackListChannels,
  executeSlackListListItems,
  executeSlackListUsers,
  executeSlackOpenDm,
  executeSlackPostMessage,
  executeSlackSearchMessages,
  executeSlackSetChannelTopic,
  executeSlackSetListTaskCompletion,
  executeSlackSetPresence,
  executeSlackUpdateListItem,
  SLACK_CONNECT_INSTRUCTIONS,
  SlackScopeDeniedError,
} from '../connectors/slackTool.service.js';

const runIdField = z.string().trim().min(1).max(80).optional();
const jitField = z.string().trim().min(8).max(512).nullable().optional();

function slackError(response: Response, err: unknown, tool: string, failedCode: string): void {
  if (err instanceof RunnerUnauthorizedError) {
    response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
    return;
  }
  if (err instanceof SlackScopeDeniedError) {
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
        connectInstructions: SLACK_CONNECT_INSTRUCTIONS,
      },
    });
    return;
  }
  if (err instanceof SlackApiError) {
    const knownCode = err.slackError;
    const status =
      knownCode === 'channel_not_found' || knownCode === 'item_not_found' || knownCode === 'list_not_found'
        ? 404
        : knownCode === 'multiple_trackers' || knownCode === 'multiple_tasks' || knownCode === 'invalid_status'
          ? 409
          : 400;
    response.status(status).json({
      error: { code: knownCode || failedCode, message: err.message },
    });
    return;
  }
  console.error(tool, err);
  const message =
    err instanceof Error && err.message.trim() ? err.message : `${tool} failed`;
  response.status(500).json({
    error: {
      code: failedCode,
      message,
    },
  });
}

export function registerSlackToolRoutes(router: Router): void {
  router.post('/:agentId/tools/slack/channels', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          types: z.string().trim().max(120).optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid channels payload' } });
        return;
      }
      const result = await executeSlackListChannels({
        agentId,
        runId: parsed.data.runId ?? null,
        types: parsed.data.types,
        limit: parsed.data.limit,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/channels', 'slack_channels_failed');
    }
  });

  router.post('/:agentId/tools/slack/users', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          limit: z.number().int().min(1).max(1000).optional(),
          cursor: z.string().trim().max(200).optional(),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid users payload' } });
        return;
      }
      const result = await executeSlackListUsers({
        agentId,
        runId: parsed.data.runId ?? null,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/users', 'slack_users_failed');
    }
  });

  router.post('/:agentId/tools/slack/search', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          query: z.string().trim().min(1).max(2000),
          count: z.number().int().min(1).max(100).optional(),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid search payload' } });
        return;
      }
      const result = await executeSlackSearchMessages({
        agentId,
        runId: parsed.data.runId ?? null,
        query: parsed.data.query,
        count: parsed.data.count,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/search', 'slack_search_failed');
    }
  });

  router.post('/:agentId/tools/slack/history', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          channel: z.string().trim().min(1).max(80),
          limit: z.number().int().min(1).max(200).optional(),
          oldest: z.string().trim().max(40).optional(),
          latest: z.string().trim().max(40).optional(),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid history payload' } });
        return;
      }
      const result = await executeSlackGetHistory({
        agentId,
        runId: parsed.data.runId ?? null,
        channel: parsed.data.channel,
        limit: parsed.data.limit,
        oldest: parsed.data.oldest,
        latest: parsed.data.latest,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/history', 'slack_history_failed');
    }
  });

  router.post('/:agentId/tools/slack/post', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          channel: z.string().trim().min(1).max(80),
          text: z.string().trim().min(1).max(4000),
          threadTs: z.string().trim().max(40).nullable().optional(),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid post payload' } });
        return;
      }
      const result = await executeSlackPostMessage({
        agentId,
        runId: parsed.data.runId ?? null,
        channel: parsed.data.channel,
        text: parsed.data.text,
        threadTs: parsed.data.threadTs ?? null,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/post', 'slack_post_failed');
    }
  });

  router.post('/:agentId/tools/slack/create-channel', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          name: z.string().trim().min(1).max(80),
          isPrivate: z.boolean().optional(),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid create-channel payload' } });
        return;
      }
      const result = await executeSlackCreateChannel({
        agentId,
        runId: parsed.data.runId ?? null,
        name: parsed.data.name,
        isPrivate: parsed.data.isPrivate,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/create-channel', 'slack_create_channel_failed');
    }
  });

  router.post('/:agentId/tools/slack/set-topic', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          channel: z.string().trim().min(1).max(80),
          topic: z.string().trim().min(1).max(250),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid set-topic payload' } });
        return;
      }
      const result = await executeSlackSetChannelTopic({
        agentId,
        runId: parsed.data.runId ?? null,
        channel: parsed.data.channel,
        topic: parsed.data.topic,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/set-topic', 'slack_set_topic_failed');
    }
  });

  router.post('/:agentId/tools/slack/open-dm', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          userId: z.string().trim().min(1).max(80),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid open-dm payload' } });
        return;
      }
      const result = await executeSlackOpenDm({
        agentId,
        runId: parsed.data.runId ?? null,
        userId: parsed.data.userId,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/open-dm', 'slack_open_dm_failed');
    }
  });

  router.post('/:agentId/tools/slack/set-presence', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          presence: z.enum(['auto', 'away']),
          jitToken: jitField,
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid set-presence payload' } });
        return;
      }
      const result = await executeSlackSetPresence({
        agentId,
        runId: parsed.data.runId ?? null,
        presence: parsed.data.presence,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/set-presence', 'slack_set_presence_failed');
    }
  });

  router.post('/:agentId/tools/slack/find-channel-lists', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          channel: z.string().trim().min(1).max(120),
          listTitle: z.string().trim().max(200).nullable().optional(),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid find-channel-lists payload' } });
        return;
      }
      const result = await executeSlackFindChannelLists({
        agentId,
        runId: parsed.data.runId ?? null,
        channel: parsed.data.channel,
        listTitle: parsed.data.listTitle ?? null,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/find-channel-lists', 'slack_find_channel_lists_failed');
    }
  });

  router.post('/:agentId/tools/slack/describe-list', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          listId: z.string().trim().min(1).max(80).optional(),
          channel: z.string().trim().min(1).max(120).optional(),
          listTitle: z.string().trim().max(200).nullable().optional(),
        })
        .refine((data) => Boolean(data.listId?.trim() || data.channel?.trim()), {
          message: 'Provide listId (F…) or channel (#todo)',
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid describe-list payload' } });
        return;
      }
      const result = await executeSlackDescribeList({
        agentId,
        runId: parsed.data.runId ?? null,
        listId: parsed.data.listId ?? null,
        channel: parsed.data.channel ?? null,
        listTitle: parsed.data.listTitle ?? null,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/describe-list', 'slack_describe_list_failed');
    }
  });

  router.post('/:agentId/tools/slack/list-items', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          listId: z.string().trim().min(1).max(80).optional(),
          channel: z.string().trim().min(1).max(120).optional(),
          listTitle: z.string().trim().max(200).nullable().optional(),
          query: z.string().trim().min(1).max(500).nullable().optional(),
          status: z.string().trim().min(1).max(120).nullable().optional(),
          completed: z.boolean().nullable().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          cursor: z.string().trim().max(300).optional(),
        })
        .refine((data) => Boolean(data.channel?.trim() || data.listId?.trim()), {
          message: 'Provide channel (#todo) or listId (F…)',
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid list-items payload' } });
        return;
      }
      const result = await executeSlackListListItems({
        agentId,
        runId: parsed.data.runId ?? null,
        listId: parsed.data.listId ?? null,
        channel: parsed.data.channel ?? null,
        listTitle: parsed.data.listTitle ?? null,
        query: parsed.data.query ?? null,
        status: parsed.data.status ?? null,
        completed: parsed.data.completed ?? null,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/list-items', 'slack_list_items_failed');
    }
  });

  router.post('/:agentId/tools/slack/create-list-item', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          listId: z.string().trim().min(1).max(80).optional(),
          channel: z.string().trim().min(1).max(120).optional(),
          listTitle: z.string().trim().max(200).nullable().optional(),
          title: z.string().trim().min(1).max(500),
          status: z.string().trim().min(1).max(120).nullable().optional(),
          assigneeUserId: z.string().trim().max(80).nullable().optional(),
          dueDate: z.string().trim().max(20).nullable().optional(),
          completed: z.boolean().nullable().optional(),
          jitToken: jitField,
        })
        .refine((data) => Boolean(data.listId?.trim() || data.channel?.trim()), {
          message: 'Provide listId (F…) or channel (#todo)',
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid create-list-item payload' } });
        return;
      }
      const result = await executeSlackCreateListItem({
        agentId,
        runId: parsed.data.runId ?? null,
        listId: parsed.data.listId ?? null,
        channel: parsed.data.channel ?? null,
        listTitle: parsed.data.listTitle ?? null,
        title: parsed.data.title,
        status: parsed.data.status ?? null,
        assigneeUserId: parsed.data.assigneeUserId ?? null,
        dueDate: parsed.data.dueDate ?? null,
        completed: parsed.data.completed ?? null,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/create-list-item', 'slack_create_list_item_failed');
    }
  });

  router.post('/:agentId/tools/slack/update-list-item', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          listId: z.string().trim().min(1).max(80).optional(),
          channel: z.string().trim().min(1).max(120).optional(),
          listTitle: z.string().trim().max(200).nullable().optional(),
          itemId: z.string().trim().min(1).max(80).optional(),
          taskTitle: z.string().trim().min(1).max(500).optional(),
          title: z.string().trim().min(1).max(500).nullable().optional(),
          status: z.string().trim().min(1).max(120).nullable().optional(),
          assigneeUserId: z.string().trim().max(80).nullable().optional(),
          dueDate: z.string().trim().max(20).nullable().optional(),
          completed: z.boolean().nullable().optional(),
          jitToken: jitField,
        })
        .refine((data) => Boolean(data.channel?.trim() || data.listId?.trim()), {
          message: 'Provide channel (#todo) or listId (F…)',
        })
        .refine((data) => Boolean(data.taskTitle?.trim() || data.itemId?.trim()), {
          message: 'Provide taskTitle or itemId (Rec…)',
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid update-list-item payload' } });
        return;
      }
      const result = await executeSlackUpdateListItem({
        agentId,
        runId: parsed.data.runId ?? null,
        listId: parsed.data.listId ?? null,
        channel: parsed.data.channel ?? null,
        listTitle: parsed.data.listTitle ?? null,
        itemId: parsed.data.itemId ?? null,
        taskTitle: parsed.data.taskTitle ?? null,
        title: parsed.data.title ?? null,
        status: parsed.data.status ?? null,
        assigneeUserId: parsed.data.assigneeUserId ?? null,
        dueDate: parsed.data.dueDate ?? null,
        completed: parsed.data.completed ?? null,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/update-list-item', 'slack_update_list_item_failed');
    }
  });

  router.post('/:agentId/tools/slack/delete-list-item', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          listId: z.string().trim().min(1).max(80).optional(),
          channel: z.string().trim().min(1).max(120).optional(),
          listTitle: z.string().trim().max(200).nullable().optional(),
          itemId: z.string().trim().min(1).max(80).optional(),
          taskTitle: z.string().trim().min(1).max(500).optional(),
          jitToken: jitField,
        })
        .refine((data) => Boolean(data.channel?.trim() || data.listId?.trim()), {
          message: 'Provide channel (#todo) or listId (F…)',
        })
        .refine((data) => Boolean(data.taskTitle?.trim() || data.itemId?.trim()), {
          message: 'Provide taskTitle or itemId (Rec…)',
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid delete-list-item payload' } });
        return;
      }
      const result = await executeSlackDeleteListItem({
        agentId,
        runId: parsed.data.runId ?? null,
        listId: parsed.data.listId ?? null,
        channel: parsed.data.channel ?? null,
        listTitle: parsed.data.listTitle ?? null,
        itemId: parsed.data.itemId ?? null,
        taskTitle: parsed.data.taskTitle ?? null,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/delete-list-item', 'slack_delete_list_item_failed');
    }
  });

  router.post('/:agentId/tools/slack/set-list-task-completion', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = z
        .object({
          runId: runIdField,
          listId: z.string().trim().min(1).max(80).optional(),
          channel: z.string().trim().min(1).max(120).optional(),
          listTitle: z.string().trim().max(200).nullable().optional(),
          itemId: z.string().trim().min(1).max(80).optional(),
          taskTitle: z.string().trim().min(1).max(500).optional(),
          completed: z.boolean(),
          jitToken: jitField,
        })
        .refine((data) => Boolean(data.channel?.trim() || data.listId?.trim()), {
          message: 'Provide channel (#todo) or listId (F…)',
        })
        .refine((data) => Boolean(data.taskTitle?.trim() || data.itemId?.trim()), {
          message: 'Provide taskTitle or itemId (Rec…)',
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid set-list-task-completion payload' } });
        return;
      }
      const result = await executeSlackSetListTaskCompletion({
        agentId,
        runId: parsed.data.runId ?? null,
        listId: parsed.data.listId ?? null,
        channel: parsed.data.channel ?? null,
        listTitle: parsed.data.listTitle ?? null,
        itemId: parsed.data.itemId ?? null,
        taskTitle: parsed.data.taskTitle ?? null,
        completed: parsed.data.completed,
        jitToken: parsed.data.jitToken,
      });
      response.json(result);
    } catch (err) {
      slackError(response, err, 'slack/set-list-task-completion', 'slack_set_list_task_completion_failed');
    }
  });
}
