import type { AgentDTO } from './agents.types.js';

export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  did: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  authentication: Array<{ schemes: string[] }>;
  skills: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  provider: {
    organization: string;
    url: string;
  };
}

const SCOPE_SKILL_MAP: Record<string, { name: string; description: string }> = {
  'web.read': { name: 'Web Reading', description: 'Navigate and read web pages' },
  'web.research': {
    name: 'Web Research',
    description: 'Search and read platforms via structured APIs (no browser)',
  },
  'web.click': { name: 'Web Interaction', description: 'Click buttons and interact with web UIs' },
  'web.transaction': { name: 'Web Transactions', description: 'Complete transactions on the web (JIT)' },
  'system.file_read': { name: 'File Reading', description: 'Read files from the local filesystem' },
  'system.file_write': { name: 'File Writing', description: 'Write files to the local filesystem' },
  'system.gui_control': { name: 'GUI Control', description: 'Control desktop apps via screen automation (hybrid only)' },
  'finance.spend_50': { name: 'Finance (≤$50)', description: 'Authorize spending up to $50 (JIT)' },
  'finance.spend_100': { name: 'Finance (≤$100)', description: 'Authorize spending up to $100 (JIT)' },
  'brain.query': { name: 'Knowledge Query', description: 'Query the org AI brain for information' },
  'brain.knowledge_read': { name: 'Knowledge Read', description: 'Read from knowledge collections' },
  'email.read': { name: 'Email Reading', description: 'Read and search connected Gmail inbox' },
  'email.send': { name: 'Email Send / Draft', description: 'Send email or save Gmail drafts via connected Gmail (send is JIT)' },
  'drive.read': { name: 'Drive Reading', description: 'List and read files from Google Drive or OneDrive' },
  'drive.write': { name: 'Drive Writing', description: 'Create or update files in Google Drive or OneDrive (JIT)' },
  'calendar.read': { name: 'Calendar Reading', description: 'List and read Google Calendar events' },
  'calendar.write': { name: 'Calendar Writing', description: 'Create or update Google Calendar events (JIT)' },
  'meet.manage': { name: 'Google Meet', description: 'Create and manage Google Meet links (JIT)' },
  'youtube.read': { name: 'YouTube Reading', description: 'Search and read YouTube via Google' },
  'youtube.publish': { name: 'YouTube Publishing', description: 'Upload or update YouTube videos (JIT)' },
  'whatsapp.send': { name: 'WhatsApp', description: 'Send files to your linked WhatsApp self-chat' },
  'whatsapp.read': { name: 'WhatsApp', description: 'Read WhatsApp contact chats' },
  'whatsapp.contact_send': { name: 'WhatsApp', description: 'Message WhatsApp contacts (with approval)' },
  'whatsapp.auto_reply': { name: 'WhatsApp', description: 'Auto-reply when messaged contacts respond' },
  'social.read': { name: 'Orbit Social Read', description: 'List Orbit channels, posts, and analytics' },
  'social.publish': { name: 'Orbit Social Publish', description: 'Publish or schedule posts via Orbit (JIT)' },
  'crm.read': { name: 'CRM Read', description: 'Search and read records in the connected CRM platform' },
  'crm.write': { name: 'CRM Write', description: 'Create, update, convert, and link CRM records (JIT)' },
  'crm.delete': { name: 'CRM Delete', description: 'Delete CRM records (JIT)' },
  'slack.read': { name: 'Slack Read', description: 'Channels, search, history, and Slack List items' },
  'slack.send': { name: 'Slack Write', description: 'Post, channels, DMs, and create/update Slack List task rows (JIT)' },
  'notion.read': { name: 'Notion Read', description: 'Search and read Notion pages and databases' },
  'notion.write': { name: 'Notion Write', description: 'Create or update Notion pages and database rows (JIT)' },
};

export function buildAgentCard(agent: AgentDTO, backendBaseUrl: string): A2AAgentCard {
  const skills = agent.permissionScopes
    .map((scope) => {
      const meta = SCOPE_SKILL_MAP[scope];
      if (!meta) return null;
      return { id: scope, name: meta.name, description: meta.description };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return {
    name: agent.name,
    description: `Qlix agent (${agent.agentKind})`,
    url: `${backendBaseUrl}/api/v1/teams/a2a/agents/${encodeURIComponent(agent.did)}`,
    version: '1.0',
    did: agent.did,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    authentication: [{ schemes: ['bearer'] }],
    skills,
    provider: {
      organization: 'Qlix',
      url: backendBaseUrl,
    },
  };
}
