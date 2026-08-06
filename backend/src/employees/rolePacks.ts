import type { EmployeeRoleManifest } from './employees.types.js';
import { employeeManifestSchema } from './manifestSchema.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const PACK_VERSION = '2026.07.1';

function defineManifest(manifest: EmployeeRoleManifest): EmployeeRoleManifest {
  return employeeManifestSchema.parse(manifest) as EmployeeRoleManifest;
}

const BASE_BRAIN = ['brain.query', 'brain.knowledge_read'] as const;

export const EMPLOYEE_ROLE_MANIFESTS: EmployeeRoleManifest[] = [
  defineManifest({
    slug: 'accountant',
    version: PACK_VERSION,
    status: 'ga',
    label: 'Accountant',
    mission:
      'Keep books current: capture invoices, track payables/receivables, reconcile accounts, and produce cash and spend reports.',
    changelog: 'Initial GA pack — email + brain; ledger posting limited until accounting MCP exists.',
    outcomes: [
      {
        id: 'capture-spend',
        title: 'Capture invoices and receipts',
        doneLooksLike: 'Vendor bills logged with amount, date, and category from email or uploads',
        playbookId: 'ingest-invoice',
        available: true,
      },
      {
        id: 'reconcile',
        title: 'Reconcile accounts',
        doneLooksLike: 'Weekly match report with unmatched items and next actions',
        playbookId: 'weekly-reconcile',
        available: false,
        limitation: 'Requires accounting/ledger connector (coming soon)',
      },
      {
        id: 'chase-ar',
        title: 'Chase unpaid invoices',
        doneLooksLike: 'Reminders sent; aging summary updated',
        playbookId: 'ar-chase',
        available: true,
      },
      {
        id: 'report',
        title: 'Cash and spend reports',
        doneLooksLike: 'On-demand or scheduled digest with cited line items',
        playbookId: 'cash-report',
        available: true,
      },
    ],
    permissionScopes: [...BASE_BRAIN],
    jitScopes: [],
    runtime: 'cloud',
    model: DEFAULT_MODEL,
    mcpRequirements: [],
    connectorsRequired: [],
    connectorsOptional: [],
    knowledgeRequirements: [
      { id: 'coa', label: 'Chart of accounts', required: false },
      { id: 'expense-policy', label: 'Expense policy', required: false },
    ],
    platformSuggestions: [
      {
        platformId: 'google',
        reason: 'Read Gmail for invoices and receipts; send AR reminders after approval',
      },
    ],
    playbooks: [
      {
        id: 'ingest-invoice',
        title: 'Ingest invoice from email',
        steps: [
          'Read recent Gmail for invoices and receipts',
          'Extract vendor, amount, date, and category',
          'Summarize captured items and flag missing fields',
        ],
        stopConditions: ['All items categorized or escalated'],
        escalation: 'Ask user to confirm ambiguous categories',
      },
      {
        id: 'ar-chase',
        title: 'Accounts receivable follow-up',
        steps: [
          'Identify overdue invoices from indexed knowledge or user input',
          'Draft polite reminder emails',
          'Request JIT approval before sending',
        ],
        stopConditions: ['Reminders sent or user declined'],
        escalation: 'Escalate invoices over 60 days to user',
      },
      {
        id: 'cash-report',
        title: 'Cash position report',
        steps: [
          'Query brain for recent spend and receivables notes',
          'Summarize cash in/out and open items',
          'Deliver report in chat or via email if approved',
        ],
        stopConditions: ['Report delivered'],
        escalation: 'Note data gaps explicitly',
      },
    ],
    allowLimitedHire: true,
    minimumCapabilityScopes: ['brain.query'],
  }),

  defineManifest({
    slug: 'sales-executive',
    version: PACK_VERSION,
    status: 'ga',
    label: 'Sales Executive',
    mission: 'Find qualified leads, personalize outreach, and keep the pipeline updated.',
    changelog: 'Initial GA pack — research, email, optional qlix-leads MCP.',
    outcomes: [
      {
        id: 'qualify',
        title: 'Qualify leads',
        doneLooksLike: 'Leads scored against ICP with reason codes',
        playbookId: 'qualify-leads',
        available: true,
      },
      {
        id: 'outreach',
        title: 'Personalized outreach',
        doneLooksLike: 'Draft emails sent after approval with CRM notes captured',
        playbookId: 'outreach',
        available: true,
      },
      {
        id: 'pipeline',
        title: 'Update pipeline',
        doneLooksLike: 'Lead status and next steps recorded',
        playbookId: 'pipeline-update',
        available: true,
      },
    ],
    permissionScopes: ['web.research', ...BASE_BRAIN, 'mcp.qlix-leads.gmb_search_leads'],
    jitScopes: [],
    runtime: 'cloud',
    model: DEFAULT_MODEL,
    mcpRequirements: [
      { serverSlug: 'qlix-leads', tools: ['gmb_search_leads', 'save_leads'], ensureRegistered: true },
    ],
    connectorsRequired: [],
    connectorsOptional: [],
    knowledgeRequirements: [
      { id: 'icp', label: 'Ideal customer profile (ICP)', required: false },
      { id: 'pitch', label: 'Pitch deck or one-pager', required: false },
    ],
    platformSuggestions: [
      {
        platformId: 'google',
        reason: 'Send personalized outreach and log follow-ups from your inbox',
      },
      {
        platformId: 'linkedin',
        reason: 'Research prospects and draft connection-oriented outreach (via Orbit)',
      },
    ],
    playbooks: [
      {
        id: 'qualify-leads',
        title: 'Qualify inbound or searched leads',
        steps: [
          'Research lead company and contact',
          'Score against ICP from brain knowledge',
          'Output qualified / nurture / disqualify with reasons',
        ],
        stopConditions: ['Each lead has a disposition'],
        escalation: 'Ask user when ICP is unclear',
      },
      {
        id: 'outreach',
        title: 'Send personalized outreach',
        steps: [
          'Draft email using pitch and lead context',
          'Request JIT approval before send',
          'Log outcome in conversation summary',
        ],
        stopConditions: ['Email sent or user declined'],
        escalation: 'Never send without approval',
      },
    ],
    allowLimitedHire: true,
    minimumCapabilityScopes: ['web.research', 'brain.query'],
  }),

  defineManifest({
    slug: 'receptionist',
    version: PACK_VERSION,
    status: 'ga',
    label: 'Receptionist',
    mission: 'Triage inbound messages, answer common questions, and route requests to the right person.',
    changelog: 'Initial GA pack — email, WhatsApp, brain.',
    outcomes: [
      {
        id: 'triage-inbox',
        title: 'Triage inbox',
        doneLooksLike: 'Messages categorized with suggested replies or routing',
        playbookId: 'inbox-triage',
        available: true,
      },
      {
        id: 'answer-faq',
        title: 'Answer FAQs',
        doneLooksLike: 'Responses grounded in company knowledge with citations',
        playbookId: 'faq-answer',
        available: true,
      },
      {
        id: 'notify',
        title: 'Notify stakeholders',
        doneLooksLike: 'Urgent items flagged via WhatsApp or email',
        playbookId: 'notify-urgent',
        available: true,
      },
    ],
    permissionScopes: [...BASE_BRAIN],
    jitScopes: [],
    runtime: 'cloud',
    model: DEFAULT_MODEL,
    mcpRequirements: [],
    connectorsRequired: [],
    connectorsOptional: [],
    knowledgeRequirements: [
      { id: 'faq', label: 'FAQ / company handbook', required: false },
      { id: 'contacts', label: 'Team directory / escalation contacts', required: false },
    ],
    platformSuggestions: [
      {
        platformId: 'google',
        reason: 'Triage inbound email and draft replies from Gmail',
      },
      {
        platformId: 'whatsapp',
        reason: 'Notify stakeholders and send urgent updates on WhatsApp',
      },
    ],
    playbooks: [
      {
        id: 'inbox-triage',
        title: 'Triage inbound email',
        steps: [
          'Read unread messages when connected',
          'Label urgency and topic',
          'Draft reply or route to owner',
        ],
        stopConditions: ['All messages triaged'],
        escalation: 'Flag unknown senders to user',
      },
      {
        id: 'faq-answer',
        title: 'Answer from knowledge base',
        steps: ['Query brain for relevant policy or FAQ', 'Draft concise answer with sources'],
        stopConditions: ['Question answered or escalated'],
        escalation: 'Hand off to human when policy is silent',
      },
    ],
    allowLimitedHire: true,
    minimumCapabilityScopes: ['brain.query'],
  }),

  defineManifest({
    slug: 'recruiter',
    version: PACK_VERSION,
    status: 'ga',
    label: 'Recruiter',
    mission: 'Source candidates, screen applications, and coordinate interview scheduling.',
    changelog: 'Initial GA pack — email, web, optional qlix-jobs MCP.',
    outcomes: [
      {
        id: 'source',
        title: 'Source candidates',
        doneLooksLike: 'Pipeline of candidates matched to open roles',
        playbookId: 'source-candidates',
        available: true,
      },
      {
        id: 'screen',
        title: 'Screen applications',
        doneLooksLike: 'Scorecards with hire / hold / pass recommendations',
        playbookId: 'screen-resume',
        available: true,
      },
      {
        id: 'nudge',
        title: 'Candidate follow-up',
        doneLooksLike: 'Status updates and nudges sent after approval',
        playbookId: 'candidate-nudge',
        available: true,
      },
    ],
    permissionScopes: [
      'web.read',
      'web.click',
      'web.transaction',
      ...BASE_BRAIN,
      'mcp.qlix-jobs.search_jobs',
      'mcp.qlix-jobs.queue_applications',
    ],
    jitScopes: ['web.transaction'],
    runtime: 'cloud',
    model: DEFAULT_MODEL,
    mcpRequirements: [
      {
        serverSlug: 'qlix-jobs',
        tools: ['search_jobs', 'queue_applications', 'list_applications'],
        ensureRegistered: true,
      },
    ],
    connectorsRequired: [],
    connectorsOptional: [],
    knowledgeRequirements: [
      { id: 'jd-templates', label: 'Job description templates', required: false },
      { id: 'scorecards', label: 'Interview scorecards', required: false },
    ],
    platformSuggestions: [
      {
        platformId: 'google',
        reason: 'Coordinate interviews and send candidate updates from Gmail',
      },
      {
        platformId: 'linkedin',
        reason: 'Source candidates and review profiles (via Orbit)',
      },
    ],
    playbooks: [
      {
        id: 'screen-resume',
        title: 'Screen a resume',
        steps: [
          'Compare resume to JD and scorecard from brain',
          'Produce structured scorecard',
          'Recommend next step',
        ],
        stopConditions: ['Scorecard complete'],
        escalation: 'Ask hiring manager on borderline cases',
      },
      {
        id: 'candidate-nudge',
        title: 'Follow up with candidate',
        steps: ['Draft status email', 'Request JIT approval', 'Send if approved'],
        stopConditions: ['Email sent or declined'],
        escalation: 'Never send without approval',
      },
    ],
    allowLimitedHire: true,
    minimumCapabilityScopes: ['brain.query'],
  }),

  defineManifest({
    slug: 'customer-support',
    version: PACK_VERSION,
    status: 'ga',
    label: 'Customer Support',
    mission: 'Resolve customer issues quickly with accurate answers and empathetic communication.',
    changelog: 'Initial GA pack — email, WhatsApp, brain knowledge.',
    outcomes: [
      {
        id: 'resolve-ticket',
        title: 'Resolve support tickets',
        doneLooksLike: 'Issue understood, answer provided, ticket closed or escalated',
        playbookId: 'ticket-resolve',
        available: true,
      },
      {
        id: 'kb-answer',
        title: 'Knowledge-base answers',
        doneLooksLike: 'Responses cite indexed docs and policies',
        playbookId: 'kb-answer',
        available: true,
      },
      {
        id: 'proactive-update',
        title: 'Proactive status updates',
        doneLooksLike: 'Customers notified of delays or resolutions via approved channels',
        playbookId: 'status-update',
        available: true,
      },
    ],
    permissionScopes: [...BASE_BRAIN],
    jitScopes: [],
    runtime: 'cloud',
    model: DEFAULT_MODEL,
    mcpRequirements: [],
    connectorsRequired: [],
    connectorsOptional: [],
    knowledgeRequirements: [
      { id: 'support-macros', label: 'Support macros / tone guide', required: false },
      { id: 'product-docs', label: 'Product documentation', required: false },
    ],
    platformSuggestions: [
      {
        platformId: 'google',
        reason: 'Handle support tickets and send resolutions from Gmail',
      },
      {
        platformId: 'whatsapp',
        reason: 'Reply to customers and send proactive status updates on WhatsApp',
      },
    ],
    playbooks: [
      {
        id: 'ticket-resolve',
        title: 'Resolve a support ticket',
        steps: [
          'Read customer message',
          'Search brain for relevant policy or product info',
          'Draft resolution; request JIT before send',
        ],
        stopConditions: ['Customer replied or ticket escalated'],
        escalation: 'Escalate billing/refund requests to human',
      },
    ],
    allowLimitedHire: true,
    minimumCapabilityScopes: ['brain.query'],
  }),

  defineManifest({
    slug: 'hr-manager',
    version: PACK_VERSION,
    status: 'ga',
    label: 'HR Manager',
    mission: 'Answer employee policy questions, support onboarding, and keep HR communications consistent.',
    changelog: 'Initial GA pack — email + brain; HRIS actions limited until integrations exist.',
    outcomes: [
      {
        id: 'policy-qa',
        title: 'Policy Q&A',
        doneLooksLike: 'Answers grounded in handbook with citations',
        playbookId: 'policy-qa',
        available: true,
      },
      {
        id: 'onboarding',
        title: 'Onboarding checklists',
        doneLooksLike: 'New hire tasks tracked and reminders sent',
        playbookId: 'onboarding-checklist',
        available: true,
      },
      {
        id: 'hr-comms',
        title: 'HR communications',
        doneLooksLike: 'Draft announcements reviewed and sent after approval',
        playbookId: 'hr-comms',
        available: true,
      },
    ],
    permissionScopes: [...BASE_BRAIN],
    jitScopes: [],
    runtime: 'cloud',
    model: DEFAULT_MODEL,
    mcpRequirements: [],
    connectorsRequired: [],
    connectorsOptional: [],
    knowledgeRequirements: [
      { id: 'handbook', label: 'Employee handbook', required: false },
      { id: 'benefits', label: 'Benefits summary', required: false },
      { id: 'onboarding-sop', label: 'Onboarding SOP', required: false },
    ],
    platformSuggestions: [
      {
        platformId: 'google',
        reason: 'Send onboarding reminders and HR announcements from Gmail',
      },
    ],
    playbooks: [
      {
        id: 'policy-qa',
        title: 'Answer HR policy question',
        steps: ['Query brain for handbook sections', 'Answer with citations', 'Escalate if ambiguous'],
        stopConditions: ['Question answered or escalated'],
        escalation: 'Route legal/sensitive topics to People Ops',
      },
      {
        id: 'onboarding-checklist',
        title: 'New hire onboarding',
        steps: [
          'Load onboarding SOP from brain',
          'Generate checklist for the role',
          'Send reminders after JIT approval',
        ],
        stopConditions: ['Checklist shared'],
        escalation: 'Confirm dates with hiring manager',
      },
    ],
    allowLimitedHire: true,
    minimumCapabilityScopes: ['brain.query'],
  }),
];

export const EMPLOYEE_ROLE_MANIFESTS_BY_SLUG = Object.fromEntries(
  EMPLOYEE_ROLE_MANIFESTS.map((m) => [m.slug, m]),
) as Record<string, EmployeeRoleManifest>;

export function getRoleManifest(slug: string): EmployeeRoleManifest | undefined {
  return EMPLOYEE_ROLE_MANIFESTS_BY_SLUG[slug];
}

export function listRoleManifests(): EmployeeRoleManifest[] {
  return EMPLOYEE_ROLE_MANIFESTS;
}
