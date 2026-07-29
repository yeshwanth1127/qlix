import * as qlix from './qlix-client.js';

function textContent(text) {
  return { content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 2) }] };
}

export async function executeJobsTool(name, args, agentId) {
  if (!agentId) {
    return { isError: true, content: [{ type: 'text', text: 'Missing X-Qlix-Agent-Id header' }] };
  }

  let ctx;
  try {
    ctx = await qlix.getJobsAgentContext(agentId);
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Agent context error: ${err.message}` }] };
  }

  const { orgId } = ctx;

  try {
    switch (name) {
      case 'upsert_candidate_profile': {
        const data = await qlix.jobsUpsertProfile(agentId, args);
        return textContent({ profile: data.profile });
      }

      case 'stage_resume': {
        if (!args.text && !args.base64) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Provide text or base64 for the resume' }],
          };
        }
        const data = await qlix.jobsStageResume(agentId, {
          text: args.text,
          base64: args.base64,
          fileName: args.fileName,
        });
        return textContent({
          profile: {
            id: data.profile?.id,
            resumeFileName: data.profile?.resumeFileName,
            resumeUrl: data.profile?.resumeUrl,
            fullName: data.profile?.fullName,
            email: data.profile?.email,
          },
          note: 'Resume staged. Continue with upsert_candidate_profile if needed, then queue_applications.',
        });
      }

      case 'search_jobs': {
        const ats = String(args.ats || '').trim();
        const board = String(args.board || '').trim();
        if (!ats || !board) {
          return { isError: true, content: [{ type: 'text', text: 'ats and board are required' }] };
        }
        const data = await qlix.jobsSearch({ ats, board, query: args.query });
        return textContent({
          count: (data.jobs || []).length,
          jobs: (data.jobs || []).slice(0, 40),
          note: 'Use queue_applications with applyUrls from these results. LinkedIn/Indeed are not supported.',
        });
      }

      case 'queue_applications': {
        const data = await qlix.jobsQueueCampaign(agentId, {
          name: args.name,
          searchQuery: args.searchQuery,
          boards: args.boards,
          applyUrls: args.applyUrls,
          campaignId: args.campaignId,
        });
        return textContent({
          ...data,
          nextSteps: [
            '1. list_applications with campaignId',
            '2. For each queued item: get_apply_brief(applicationId)',
            '3. browser fill + upload resume; record_application_result(awaiting_jit) before submit',
            '4. After JIT approve: submit; record_application_result(submitted|blocked|failed)',
          ],
        });
      }

      case 'list_applications': {
        const campaignId = String(args.campaignId || '').trim();
        if (!campaignId) {
          return { isError: true, content: [{ type: 'text', text: 'campaignId is required' }] };
        }
        const data = await qlix.jobsListApplications(orgId, campaignId, args.status);
        return textContent(data);
      }

      case 'get_apply_brief': {
        const applicationId = String(args.applicationId || '').trim();
        if (!applicationId) {
          return { isError: true, content: [{ type: 'text', text: 'applicationId is required' }] };
        }
        const data = await qlix.jobsGetBrief(orgId, applicationId);
        return textContent({
          application: data.application,
          profile: {
            ...data.profile,
            resumeText: data.profile?.resumeText
              ? String(data.profile.resumeText).slice(0, 4000)
              : null,
          },
          playbook: data.playbook,
          reminder:
            'Fill from profile only. Upload resume from resumeUrl. Do NOT submit until JIT approval. Never invent answers.',
        });
      }

      case 'record_application_result': {
        const applicationId = String(args.applicationId || '').trim();
        const outcome = String(args.outcome || '').trim();
        if (!applicationId || !outcome) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'applicationId and outcome are required' }],
          };
        }
        const data = await qlix.jobsRecordResult(orgId, applicationId, {
          outcome,
          note: args.note,
          confirmationUrl: args.confirmationUrl,
          agentRunId: args.agentRunId,
        });
        return textContent({ application: data.application });
      }

      default:
        return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err?.message || String(err) }] };
  }
}

export const JOBS_TOOL_CATALOG = [
  {
    name: 'upsert_candidate_profile',
    description: 'Update candidate profile fields used on apply forms.',
    inputSchema: {
      type: 'object',
      properties: {
        fullName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        location: { type: 'string' },
        linkedinUrl: { type: 'string' },
        githubUrl: { type: 'string' },
        portfolioUrl: { type: 'string' },
        workAuth: { type: 'string' },
        salaryBand: { type: 'string' },
        summary: { type: 'string' },
        skills: { type: 'array', items: { type: 'string' } },
        answerBank: {
          type: 'array',
          items: {
            type: 'object',
            properties: { question: { type: 'string' }, answer: { type: 'string' } },
          },
        },
      },
    },
  },
  {
    name: 'stage_resume',
    description: 'Stage resume text or base64 file for browser upload. Call before queue_applications.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        base64: { type: 'string' },
        fileName: { type: 'string' },
      },
    },
  },
  {
    name: 'search_jobs',
    description: 'Search Greenhouse / Lever / Ashby public job boards. Returns apply URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        ats: { type: 'string', enum: ['greenhouse', 'lever', 'ashby'] },
        board: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['ats', 'board'],
    },
  },
  {
    name: 'queue_applications',
    description:
      'Queue apply URLs or search boards into a campaign. Rejects LinkedIn/Indeed. Requires stage_resume first.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        searchQuery: { type: 'string' },
        boards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ats: { type: 'string', enum: ['greenhouse', 'lever', 'ashby'] },
              board: { type: 'string' },
            },
          },
        },
        applyUrls: { type: 'array', items: { type: 'string' } },
        campaignId: { type: 'string' },
      },
    },
  },
  {
    name: 'list_applications',
    description: 'List applications for a campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'get_apply_brief',
    description: 'Get profile + resume URL + ATS playbook for one application before browser fill.',
    inputSchema: {
      type: 'object',
      properties: { applicationId: { type: 'string' } },
      required: ['applicationId'],
    },
  },
  {
    name: 'record_application_result',
    description: 'Record apply outcome: awaiting_jit | submitted | blocked | failed | skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string' },
        outcome: {
          type: 'string',
          enum: ['submitted', 'blocked', 'failed', 'skipped', 'awaiting_jit'],
        },
        note: { type: 'string' },
        confirmationUrl: { type: 'string' },
        agentRunId: { type: 'string' },
      },
      required: ['applicationId', 'outcome'],
    },
  },
];
