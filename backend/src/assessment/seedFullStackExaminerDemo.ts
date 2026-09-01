import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import {
  CAMPUS_MARKET_BRIEF,
  asJson,
  campusMarketObservationLog,
} from './campusMarketObservations.js';
import { ensureFullStackExaminerTeam } from './ensureExaminerTeam.js';
import { resolveExaminerSeedOrg } from './examinerSeedOrg.js';
import {
  DEMO_SESSION_METADATA_KEY,
  FULL_STACK_EXAMINER_RECIPE_ID,
  FULL_STACK_EXAMINER_TEAM_NAME,
} from './examinerTeamRecipe.js';

async function seedOneOrg(orgId: string, userId: string, orgName: string): Promise<void> {
  console.log(`\nOrg: ${orgName} (${orgId})`);
  console.log(`User: ${userId}`);

  await prisma.orgPlugin.upsert({
    where: { orgId_pluginId: { orgId, pluginId: 'assessment' } },
    update: { enabled: true, disabledAt: null },
    create: { orgId, pluginId: 'assessment', enabled: true, enabledByUserId: userId },
  });

  const team = await ensureFullStackExaminerTeam({ orgId, userId });
  console.log(`Team: ${team.name} (${team.id}) — ${team.members?.length ?? 0} workers`);

  const windowStartsAt = new Date('2026-08-11T03:30:00.000Z');
  const windowEndsAt = new Date('2026-08-18T18:30:00.000Z');

  const latestFramework = await prisma.evaluationFramework.findFirst({
    where: { orgId, recipeId: FULL_STACK_EXAMINER_RECIPE_ID },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const framework = await prisma.evaluationFramework.create({
    data: {
      orgId,
      recipeId: FULL_STACK_EXAMINER_RECIPE_ID,
      name: 'Campus Market — full stack job-readiness',
      version: (latestFramework?.version ?? 0) + 1,
      criteria: asJson([...CAMPUS_MARKET_BRIEF.criteria]),
      status: 'published',
      createdByUserId: userId,
    },
  });

  const existingSession = await prisma.workSession.findFirst({
    where: {
      orgId,
      metadata: { path: ['demoKey'], equals: DEMO_SESSION_METADATA_KEY },
    },
    select: { id: true },
  });
  if (existingSession) {
    await prisma.evidenceRecord.deleteMany({ where: { sessionId: existingSession.id } });
    await prisma.projectSnapshot.deleteMany({ where: { sessionId: existingSession.id } });
    await prisma.workSession.delete({ where: { id: existingSession.id } });
  }

  const session = await prisma.workSession.create({
    data: {
      orgId,
      recipeId: FULL_STACK_EXAMINER_RECIPE_ID,
      subjectRef: CAMPUS_MARKET_BRIEF.subjectRef,
      teamId: team.id,
      frameworkId: framework.id,
      status: 'submitted',
      consentGrantedAt: new Date('2026-08-11T03:32:00.000Z'),
      submittedAt: new Date('2026-08-14T05:05:00.000Z'),
      projectDescription: CAMPUS_MARKET_BRIEF.projectDescription,
      expectedStack: [...CAMPUS_MARKET_BRIEF.expectedStack],
      windowStartsAt,
      windowEndsAt,
      aiUsagePolicy: CAMPUS_MARKET_BRIEF.aiUsagePolicy,
      checklist: asJson([...CAMPUS_MARKET_BRIEF.checklist]),
      requiredDeliverables: [...CAMPUS_MARKET_BRIEF.requiredDeliverables],
      metadata: asJson({ demoKey: DEMO_SESSION_METADATA_KEY, workspace: 'campus-market' }),
    },
  });

  const { evidence, snapshots } = campusMarketObservationLog();
  await prisma.evidenceRecord.createMany({
    data: evidence.map((e) => ({
      sessionId: session.id,
      kind: e.kind,
      source: 'vscode_extension',
      occurredAt: e.occurredAt,
      payload: asJson(e.payload),
      redacted: e.redacted ?? false,
    })),
  });
  for (const snap of snapshots) {
    await prisma.projectSnapshot.create({
      data: {
        sessionId: session.id,
        label: snap.label,
        fileTreeHash: snap.fileTreeHash,
        fileHashes: asJson(snap.fileHashes),
        createdAt: snap.createdAt,
      },
    });
  }

  const examinerIds = [
    team.supervisorAgentId,
    ...(team.members ?? []).map((m) => m.agentId),
  ].filter((id): id is string => Boolean(id));
  const agentNames = await prisma.agent.findMany({
    where: { id: { in: examinerIds } },
    select: { name: true, permissionScopes: true },
    orderBy: { name: 'asc' },
  });

  console.log(`Session: ${session.id}  status=${session.status}`);
  console.log(`Evidence rows: ${evidence.length}  snapshots: ${snapshots.length}`);
  console.log(`Framework: ${framework.id} v${framework.version}`);
  for (const a of agentNames) {
    console.log(`  ${a.name}: ${a.permissionScopes.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const t = await resolveExaminerSeedOrg();
  await seedOneOrg(t.orgId, t.userId, t.orgName);
  console.log(`\nDone. Team "${FULL_STACK_EXAMINER_TEAM_NAME}" seeded only for ${t.orgName} (${t.email}).`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
