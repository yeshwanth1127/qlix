/**
 * One-shot clone of production "WhatsApp Lead Outreach" onto local y@y.com.
 * Run: npx tsx src/assessment/cloneWhatsAppLeadOutreachTeam.ts
 */
import type { Prisma } from '@prisma/client';
import type { PermissionScope } from '../agents/agents.types.js';
import { generateDID } from '../agents/did.js';
import { generateKeypair } from '../agents/keypair.js';
import { AgentsRepository } from '../agents/agents.repository.js';
import { encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { prisma } from '../lib/prisma.js';
import { TeamsRepository } from '../teams/teams.repository.js';
import type { StageChannel, StageKind } from '../teams/stageKind.js';
import type { TeamConfig } from '../teams/teams.types.js';
import { resolveExaminerSeedOrg } from './examinerSeedOrg.js';

const TEAM_NAME = 'WhatsApp Lead Outreach';
const TEAM_DESCRIPTION =
  '2-agent pipeline: read & filter Excel leads, then WhatsApp outreach with parallel reply collection and sheet delivery.';

const TEAM_CONFIG: TeamConfig = {
  playbook: 'none',
  retryPolicy: 'once',
  autoSequence: false,
  defaultModel: 'openrouter/openai/gpt-4o-mini',
  pipelineMode: true,
  subtaskTimeoutMs: 300_000,
  maxParallelWorkers: 2,
  humanInLoopTriggers: ['web.transaction', 'finance.spend_50', 'finance.spend_100'],
  waitSteps: [
    {
      id: 'whatsapp_reply_wait',
      afterStageOrder: 2,
      trigger: { kind: 'whatsapp_inbound', fulfillment: 'collect_until_timeout' },
      sideEffects: [
        {
          id: 'live_reply_sheet',
          kind: 'live_sandbox_artifact',
          title: 'WhatsApp responders',
          filter: { include: ['interested', 'unclear'], classifier: 'reply_interest' },
          deliver: { when: 'on_resume', channel: 'whatsapp' },
          dedupeBy: 'contact_jid',
          contactAck: 'fixed',
        },
      ],
      resume: { injectAs: 'whatsapp_responses' },
    },
  ],
};

type Slot = {
  id: 'supervisor' | 'lead_processor' | 'whatsapp_outreach';
  name: string;
  role: string;
  description: string;
  permissionScopes: PermissionScope[];
  jitScopes: PermissionScope[];
  alwaysScopes: PermissionScope[];
  stageOrder?: number;
  stageKind?: StageKind;
  alsoKinds?: StageKind[];
  channels?: StageChannel[];
};

const SUPERVISOR: Slot = {
  id: 'supervisor',
  name: 'Lead Filter and Messenger',
  role: 'supervisor',
  description:
    'Coordinates the 2-stage pipeline: (1) Lead Processor reads and filters the Excel upload, (2) WhatsApp Outreach sends messages, waits for replies, and delivers the response sheet.',
    permissionScopes: [
      'brain.query',
      'files.create',
      'conversation',
      'whatsapp.auto_reply',
      'whatsapp.contact_send',
      'whatsapp.send',
    ],
  jitScopes: ['files.create', 'whatsapp.auto_reply', 'whatsapp.contact_send'],
  alwaysScopes: ['brain.query', 'whatsapp.send'],
};

const WORKERS: Slot[] = [
  {
    id: 'lead_processor',
    name: 'Lead Processor',
    role: 'lead processor',
    description:
      'Reads the user uploaded Excel file, extracts lead rows, and filters them against the criteria in the user request. Outputs a structured list of qualified leads ready for outreach.',
    permissionScopes: ['brain.query', 'files.create'],
    jitScopes: [],
    alwaysScopes: ['brain.query', 'files.create'],
    stageOrder: 1,
    stageKind: 'source',
    alsoKinds: [],
    channels: [],
  },
  {
    id: 'whatsapp_outreach',
    name: 'WhatsApp Outreach',
    role: 'outreach',
    description:
      'Sends personalized WhatsApp messages to each filtered lead in parallel. Waits for their replies, collects responses into a live Excel sheet, and delivers the final spreadsheet to the user on WhatsApp.',
    permissionScopes: [
      'brain.query',
      'files.create',
      'whatsapp.contact_send',
      'conversation',
      'whatsapp.auto_reply',
      'whatsapp.send',
    ],
    jitScopes: ['whatsapp.contact_send'],
    alwaysScopes: ['brain.query', 'files.create', 'conversation', 'whatsapp.auto_reply', 'whatsapp.send'],
    stageOrder: 2,
    stageKind: 'act',
    alsoKinds: ['wait'],
    channels: ['whatsapp'],
  },
];

const agentsRepo = new AgentsRepository();
const teamsRepo = new TeamsRepository();

async function ensureAgent(input: {
  userId: string;
  orgId: string;
  slot: Slot;
}): Promise<{ id: string; name: string }> {
  const existing = await prisma.agent.findFirst({
    where: { orgId: input.orgId, name: input.slot.name, agentKind: 'standard' },
    select: { id: true, name: true },
  });
  const shared = {
    description: input.slot.description,
    permissionScopes: input.slot.permissionScopes,
    jitScopes: input.slot.jitScopes,
    alwaysScopes: input.slot.alwaysScopes,
    runtime: 'cloud' as const,
    llmMode: 'proxy' as const,
    llmProvider: 'exora' as const,
    llmModel: 'exora/exora-general',
    status: 'active',
    toolProfile: 'full',
    agentTier: 'free',
  };
  if (existing) {
    await prisma.agent.update({
      where: { id: existing.id },
      data: shared,
    });
    return existing;
  }
  const did = generateDID();
  const { publicKey, privateKey } = await generateKeypair();
  const agent = await agentsRepo.createAgent({
    userId: input.userId,
    orgId: input.orgId,
    name: input.slot.name,
    description: input.slot.description,
    did,
    publicKey,
    runtime: 'cloud',
    model: 'exora/exora-general',
    llmMode: 'proxy',
    llmProvider: 'exora',
    localInferenceMode: null,
    permissionScopes: input.slot.permissionScopes,
    jitScopes: input.slot.jitScopes,
    alwaysScopes: input.slot.alwaysScopes,
    webauthnCredentialId: null,
    cloudPrivateKeyEnc: encryptForAgentSecrets(privateKey),
    cloudProvisioningStatus: null,
  });
  await prisma.agent.update({
    where: { id: agent.id },
    data: { toolProfile: 'full', agentTier: 'free' },
  });
  return { id: agent.id, name: agent.name };
}

async function main(): Promise<void> {
  const seed = await resolveExaminerSeedOrg();
  console.log(`Target ${seed.email} org=${seed.orgId} (${seed.orgName})`);

  const { ensureWhatsAppLeadOutreachSequentialWorkflow } = await import(
    '../conversations/ensureWhatsAppLeadOutreachSequentialWorkflow.js'
  );
  const { workflowVersionId } = await ensureWhatsAppLeadOutreachSequentialWorkflow();
  const teamConfig: TeamConfig = {
    ...TEAM_CONFIG,
    conversationWorkflowVersionId: workflowVersionId,
  };

  const supervisor = await ensureAgent({ userId: seed.userId, orgId: seed.orgId, slot: SUPERVISOR });
  const workers: { slot: Slot; agentId: string }[] = [];
  for (const slot of WORKERS) {
    const agent = await ensureAgent({ userId: seed.userId, orgId: seed.orgId, slot });
    workers.push({ slot, agentId: agent.id });
  }

  const existing = await prisma.team.findFirst({
    where: { orgId: seed.orgId, name: TEAM_NAME },
    select: { id: true },
  });

  const config = teamConfig as unknown as Prisma.InputJsonValue;
  const memberRows = workers.map(({ slot, agentId }) => ({
    agentId,
    role: slot.role,
    delegatedScopes: slot.permissionScopes,
    stageOrder: slot.stageOrder ?? 1,
    stageKind: slot.stageKind ?? undefined,
    alsoKinds: slot.alsoKinds ?? [],
    channels: slot.channels ?? [],
  }));

  if (existing) {
    await prisma.team.update({
      where: { id: existing.id },
      data: {
        description: TEAM_DESCRIPTION,
        supervisorAgentId: supervisor.id,
        status: 'active',
        config,
      },
    });
    await prisma.teamMember.deleteMany({ where: { teamId: existing.id } });
    for (const row of memberRows) {
      await prisma.teamMember.create({ data: { teamId: existing.id, ...row } });
    }
    const team = await teamsRepo.findById(existing.id);
    if (!team) throw new Error('Failed to reload team');
    console.log(`Updated team ${team.id} (${team.name}) members=${team.members?.length ?? 0}`);
    console.log(`Managed workflow: ${workflowVersionId}`);
    console.log(`Supervisor: ${team.supervisorAgent?.name}`);
    for (const m of team.members ?? []) {
      console.log(`  stage ${m.stageOrder} ${m.role} / ${m.agent?.name} kind=${m.stageKind} also=${m.alsoKinds?.join(',') || '-'} ch=${m.channels?.join(',') || '-'}`);
    }
    return;
  }

  const team = await teamsRepo.createTeam({
    orgId: seed.orgId,
    createdByUserId: seed.userId,
    did: generateDID(),
    name: TEAM_NAME,
    description: TEAM_DESCRIPTION,
    supervisorAgentId: supervisor.id,
    config: teamConfig,
    members: memberRows,
  });
  await prisma.team.update({ where: { id: team.id }, data: { status: 'active' } });
  console.log(`Created team ${team.id} (${team.name}) members=${team.members?.length ?? 0}`);
  console.log(`Managed workflow: ${workflowVersionId}`);
  console.log(`Supervisor: ${supervisor.name}`);
  for (const m of team.members ?? []) {
    console.log(`  stage ${m.stageOrder} ${m.role} / ${m.agent?.name} kind=${m.stageKind}`);
  }
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
