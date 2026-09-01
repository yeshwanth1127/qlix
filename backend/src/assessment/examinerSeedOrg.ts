import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/** Default tenant for this assessment work. Override with QLIX_ASSESSMENT_SEED_ORG_ID or QLIX_ASSESSMENT_SEED_EMAIL. */
export const DEFAULT_EXAMINER_SEED_EMAIL = 'y@y.com';

export async function resolveExaminerSeedOrg(): Promise<{
  orgId: string;
  userId: string;
  orgName: string;
  email: string;
}> {
  const orgIdEnv = process.env.QLIX_ASSESSMENT_SEED_ORG_ID?.trim();
  const emailEnv = process.env.QLIX_ASSESSMENT_SEED_EMAIL?.trim().toLowerCase();

  let user: (User & { organization: { id: string; name: string } }) | null = null;
  if (orgIdEnv) {
    user = await prisma.user.findFirst({
      where: { orgId: orgIdEnv },
      include: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  } else {
    const email = emailEnv || DEFAULT_EXAMINER_SEED_EMAIL;
    user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { organization: { select: { id: true, name: true } } },
    });
  }

  if (!user) {
    throw new Error(
      'Could not resolve Yeshwanth org. Set QLIX_ASSESSMENT_SEED_ORG_ID or QLIX_ASSESSMENT_SEED_EMAIL.',
    );
  }
  return {
    orgId: user.orgId,
    userId: user.id,
    orgName: user.organization.name,
    email: user.email,
  };
}
