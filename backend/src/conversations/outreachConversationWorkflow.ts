import type { ConversationWorkflow } from './workflow.types.js';

export const OUTREACH_CONVERSATION_WORKFLOW_KEY = 'outreach.conversation';

/** Default send-or-listen then collect-one-reply workflow for the Outreach plugin. */
export const OUTREACH_CONVERSATION_WORKFLOW: ConversationWorkflow = {
  key: OUTREACH_CONVERSATION_WORKFLOW_KEY,
  version: 1,
  entryNodeId: 'gate',
  nodes: [
    {
      id: 'gate',
      type: 'branch',
      variable: 'openingMessage',
      cases: [{ equals: '', next: 'await_reply' }],
      default: 'open',
    },
    { id: 'open', type: 'send', content: '{{openingMessage}}', next: 'await_reply' },
    { id: 'await_reply', type: 'collect', content: '', variable: 'reply', next: 'done' },
    { id: 'done', type: 'complete', result: { reply: '{{reply}}' } },
  ],
};
