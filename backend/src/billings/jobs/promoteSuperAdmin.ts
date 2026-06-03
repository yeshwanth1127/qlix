import { prisma } from '../../lib/prisma.js';

function parseEmail(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith('--email='));
  if (!arg) return null;
  const email = arg.slice('--email='.length).trim().toLowerCase();
  return email.length ? email : null;
}

async function main(): Promise<void> {
  const email = parseEmail(process.argv.slice(2)) ?? process.env.SUPER_ADMIN_EMAIL ?? null;
  if (!email) {
    throw new Error('Provide --email=<address> or SUPER_ADMIN_EMAIL');
  }
  const user = await prisma.user.update({
    where: { email },
    data: { isSuperAdmin: true },
    select: { id: true, email: true, isSuperAdmin: true },
  });
  // eslint-disable-next-line no-console
  console.log(`Promoted ${user.email} (${user.id}) isSuperAdmin=${user.isSuperAdmin}`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[promoteSuperAdmin]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });

