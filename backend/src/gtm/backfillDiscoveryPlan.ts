import 'dotenv/config';
import { BrainAgentService } from '../aiBrain/brainAgent.service.js';
import { resolveExaminerSeedOrg } from '../assessment/examinerSeedOrg.js';
import { prisma } from '../lib/prisma.js';
import { ideaPayloadSchema } from './discoveryFoundation.service.js';
import {
  getLatestDiscoveryPlan,
  startDiscoveryPlanPipeline,
} from './gtmDiscoveryPlan.service.js';

async function main(): Promise<void> {
  const seed = await resolveExaminerSeedOrg();
  const idea = await prisma.gtmIdea.findFirst({
    where: { orgId: seed.orgId, status: 'active' },
    orderBy: { version: 'desc' },
  });

  if (!idea) {
    console.log(`No active GtmIdea for ${seed.email}. Complete the six discovery questions first.`);
    return;
  }

  const parsed = ideaPayloadSchema.safeParse(idea.content);
  if (!parsed.success) {
    console.error('Stored idea content is invalid:', parsed.error.flatten());
    process.exitCode = 1;
    return;
  }

  const brainAgents = new BrainAgentService();
  const brain = await brainAgents.normalizeOrgBrain(seed.orgId);
  if (!brain) {
    console.error('Org Brain is missing. Create Exa before backfilling the discovery plan.');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: seed.userId },
    select: { role: true },
  });

  console.log(`Backfilling discovery plan for ${seed.email} (idea v${idea.version})…`);
  const plan = await startDiscoveryPlanPipeline({
    orgId: seed.orgId,
    userId: seed.userId,
    role: user.role,
    brainAgentId: brain.id,
    brainModel: brain.model,
    ideaVersion: idea.version,
    content: parsed.data,
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const latest = await getLatestDiscoveryPlan(seed.orgId);
    if (!latest || latest.id !== plan.id) continue;
    if (latest.status === 'ready') {
      console.log('Discovery plan ready:', latest.id);
      return;
    }
    if (latest.status === 'failed') {
      console.error('Discovery plan failed:', latest.errorMessage);
      process.exitCode = 1;
      return;
    }
  }

  console.error('Timed out waiting for discovery plan generation.');
  process.exitCode = 1;
}

void main().finally(async () => {
  await prisma.$disconnect();
});
