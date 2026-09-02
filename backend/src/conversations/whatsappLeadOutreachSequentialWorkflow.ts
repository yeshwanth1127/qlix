import type { ConversationWorkflow } from './workflow.types.js';

export const WHATSAPP_LEAD_OUTREACH_SEQUENTIAL_KEY = 'whatsapp.lead_outreach.sequential';

/**
 * Per-contact WhatsApp flow for lead outreach:
 * greeting → Brain brochure (optional) → 4 native polls with a wait after each.
 *
 * Team wait flush starts this workflow once per contact; later polls are sent only
 * after each inbound reply via the conversation middleware.
 */
export const WHATSAPP_LEAD_OUTREACH_SEQUENTIAL_WORKFLOW: ConversationWorkflow = {
  key: WHATSAPP_LEAD_OUTREACH_SEQUENTIAL_KEY,
  version: 1,
  entryNodeId: 'greet',
  nodes: [
    {
      id: 'greet',
      type: 'send',
      content:
        '{{greetingMessage}}',
      next: 'brochure_gate',
    },
    {
      id: 'brochure_gate',
      type: 'branch',
      variable: 'documentId',
      cases: [{ equals: '', next: 'poll_bangalore' }],
      default: 'send_brochure',
    },
    {
      id: 'send_brochure',
      type: 'action',
      action: 'communication.send_brain_document',
      input: { documentId: '{{documentId}}' },
      next: 'poll_bangalore',
      onError: 'poll_bangalore',
    },
    {
      id: 'poll_bangalore',
      type: 'ask',
      content: 'Are you based in Bangalore?',
      variable: 'inBangalore',
      prompt: {
        kind: 'choice',
        content: 'Are you based in Bangalore?',
        options: ['Yes', 'No'],
        maxSelections: 1,
      },
      next: 'poll_fresher',
    },
    {
      id: 'poll_fresher',
      type: 'ask',
      content: 'Are you a fresher or a graduate with experience?',
      variable: 'fresherOrGraduate',
      prompt: {
        kind: 'choice',
        content: 'Are you a fresher or a graduate with experience?',
        options: ['Fresher', 'Graduate'],
        maxSelections: 1,
      },
      next: 'poll_experience',
    },
    {
      id: 'poll_experience',
      type: 'ask',
      content: 'Do you have work experience?',
      variable: 'hasWorkExperience',
      prompt: {
        kind: 'choice',
        content: 'Do you have work experience?',
        options: ['Yes', 'No'],
        maxSelections: 1,
      },
      next: 'poll_interest',
    },
    {
      id: 'poll_interest',
      type: 'ask',
      content: 'Are you interested in the program?',
      variable: 'interested',
      prompt: {
        kind: 'choice',
        content: 'Are you interested in the program?',
        options: ['Yes', 'No'],
        maxSelections: 1,
      },
      next: 'done',
    },
    {
      id: 'done',
      type: 'complete',
      result: {
        inBangalore: '{{inBangalore}}',
        fresherOrGraduate: '{{fresherOrGraduate}}',
        hasWorkExperience: '{{hasWorkExperience}}',
        interested: '{{interested}}',
        contactName: '{{contactName}}',
        contactJid: '{{contactJid}}',
      },
    },
  ],
};
