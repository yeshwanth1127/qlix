import { prisma } from '../../lib/prisma.js';
import { runBillingRollups, type RollupMode } from './billingRollups.js';

function parseArgs(argv: string[]): { mode: RollupMode; date?: Date; billingCycle?: string } {
  const modeArg = argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length) ?? 'both';
  const mode = (modeArg === 'daily' || modeArg === 'monthly' || modeArg === 'both' ? modeArg : 'both') as RollupMode;
  const dateArg = argv.find((a) => a.startsWith('--date='))?.slice('--date='.length);
  const cycleArg = argv.find((a) => a.startsWith('--cycle='))?.slice('--cycle='.length);
  const date = dateArg ? new Date(`${dateArg}T00:00:00.000Z`) : undefined;
  return { mode, date: date && !Number.isNaN(date.getTime()) ? date : undefined, billingCycle: cycleArg };
}

async function main(): Promise<void> {
  const { mode, date, billingCycle } = parseArgs(process.argv.slice(2));
  const res = await runBillingRollups({
    prisma,
    mode,
    targetDateUtc: date,
    billingCycle,
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(res, null, 2));
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[runBillingRollups]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });

