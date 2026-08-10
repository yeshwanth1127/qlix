import * as qlix from './qlix-client.js';

function textContent(text) {
  return { content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 2) }] };
}

export async function executeScheduleTool(name, args, agentId) {
  if (!agentId) {
    return { isError: true, content: [{ type: 'text', text: 'Missing X-Qlix-Agent-Id header' }] };
  }

  let ctx;
  try {
    ctx = await qlix.getScheduleAgentContext(agentId);
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Agent context error: ${err.message}` }] };
  }

  try {
    switch (name) {
      case 'schedule_create': {
        const scheduleType = String(args.scheduleType || '').trim();
        const prompt = String(args.prompt || '').trim();
        if (!scheduleType || !prompt) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'scheduleType and prompt are required' }],
          };
        }
        const data = await qlix.schedulesCreate(agentId, {
          scheduleType,
          cronExpression: args.cronExpression,
          onceAt: args.onceAt,
          intervalSeconds: args.intervalSeconds,
          prompt,
          label: args.label,
          maxRuns: args.maxRuns,
          targetAgentId: args.targetAgentId,
        });
        return textContent({
          schedule: data.schedule,
          note: 'Event registered. The agent will receive the prompt when nextRunAt is due (tick every ~1 minute).',
        });
      }

      case 'schedule_list': {
        const data = await qlix.schedulesList(agentId, {
          status: args.status,
          includeCancelled: args.includeCancelled,
        });
        return textContent({ count: (data.schedules || []).length, schedules: data.schedules });
      }

      case 'schedule_get': {
        const scheduleId = String(args.scheduleId || '').trim();
        if (!scheduleId) {
          return { isError: true, content: [{ type: 'text', text: 'scheduleId is required' }] };
        }
        const data = await qlix.schedulesGet(agentId, scheduleId);
        return textContent({ schedule: data.schedule });
      }

      case 'schedule_update': {
        const scheduleId = String(args.scheduleId || '').trim();
        if (!scheduleId) {
          return { isError: true, content: [{ type: 'text', text: 'scheduleId is required' }] };
        }
        const data = await qlix.schedulesUpdate(agentId, scheduleId, {
          label: args.label,
          prompt: args.prompt,
          cronExpression: args.cronExpression,
          onceAt: args.onceAt,
          intervalSeconds: args.intervalSeconds,
          enabled: args.enabled,
          status: args.status,
          maxRuns: args.maxRuns,
        });
        return textContent({ schedule: data.schedule });
      }

      case 'schedule_cancel': {
        const scheduleId = String(args.scheduleId || '').trim();
        if (!scheduleId) {
          return { isError: true, content: [{ type: 'text', text: 'scheduleId is required' }] };
        }
        const data = await qlix.schedulesCancel(agentId, scheduleId);
        return textContent({ schedule: data.schedule, note: 'Schedule cancelled.' });
      }

      default:
        return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err?.message || String(err) }] };
  }
}

export const SCHEDULE_TOOL_CATALOG = [
  {
    name: 'schedule_create',
    description:
      'Create a cron / once / interval event that enqueues a prompt to this agent when due.',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleType: { type: 'string', enum: ['cron', 'once', 'interval'] },
        cronExpression: { type: 'string' },
        onceAt: { type: 'string' },
        intervalSeconds: { type: 'integer' },
        prompt: { type: 'string' },
        label: { type: 'string' },
        maxRuns: { type: 'integer' },
        targetAgentId: { type: 'string' },
      },
      required: ['scheduleType', 'prompt'],
    },
  },
  {
    name: 'schedule_list',
    description: 'List scheduled events for this agent.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'paused', 'cancelled', 'completed'] },
        includeCancelled: { type: 'boolean' },
      },
    },
  },
  {
    name: 'schedule_get',
    description: 'Get one schedule by id.',
    inputSchema: {
      type: 'object',
      properties: { scheduleId: { type: 'string' } },
      required: ['scheduleId'],
    },
  },
  {
    name: 'schedule_update',
    description: 'Update, pause, or resume a schedule.',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleId: { type: 'string' },
        label: { type: 'string' },
        prompt: { type: 'string' },
        cronExpression: { type: 'string' },
        onceAt: { type: 'string' },
        intervalSeconds: { type: 'integer' },
        enabled: { type: 'boolean' },
        status: { type: 'string', enum: ['active', 'paused'] },
        maxRuns: { type: 'integer' },
      },
      required: ['scheduleId'],
    },
  },
  {
    name: 'schedule_cancel',
    description: 'Cancel a scheduled event permanently.',
    inputSchema: {
      type: 'object',
      properties: { scheduleId: { type: 'string' } },
      required: ['scheduleId'],
    },
  },
];
