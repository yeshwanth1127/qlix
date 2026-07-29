import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { assertCanViewBilling } from '../lib/billingAccess.js';
import { billingCycleFromDateUtc } from '../billings/lib/billingCycle.js';
import { Prisma } from '@prisma/client';

export function createWalletRouter(): Router {
  const router = Router();

  router.use(authenticateUser(true));
  // Product RBAC: within an organization, billing/wallet data is owner-only — members and admins
  // must not see it. Individual workspaces always see their own wallet.
  router.use(assertCanViewBilling);

  // GET /api/v1/wallet/balance
  router.get('/balance', async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;

      // For individual workspace, use userId; for org workspace, use orgId
      const wallet =
        auth.orgId && auth.orgId.length > 0
          ? await prisma.wallet.findUnique({ where: { orgId: auth.orgId } })
          : await prisma.wallet.findUnique({ where: { userId: auth.userId } });

      if (!wallet) {
        response.json({
          balance: '0',
          freeBalance: '0',
          paidBalance: '0',
          freeExpiresAt: null,
          currency: 'INR',
          billingCycle: billingCycleFromDateUtc(new Date()),
          monthToDate: { spend: '0', successfulEvents: 0 },
        });
        return;
      }

      const cycle = billingCycleFromDateUtc(new Date());

      // MTD spend and event count: both individual and org wallets track by orgId in SuccessfulEvent
      // (wallet is org-scoped; individual users are in their own org)
      const [eventCount, spend] = await Promise.all([
        prisma.successfulEvent.count({
          where: { orgId: wallet.orgId ?? auth.userId, billingCycle: cycle },
        }),
        prisma.successfulEvent.aggregate({
          where: { orgId: wallet.orgId ?? auth.userId, billingCycle: cycle },
          _sum: { amountCharged: true },
        }),
      ]);

      response.json({
        balance: wallet.balance.toString(),
        freeBalance: wallet.freeBalance.toString(),
        paidBalance: wallet.paidBalance.toString(),
        freeExpiresAt: wallet.freeExpiresAt ? wallet.freeExpiresAt.toISOString() : null,
        currency: wallet.currency,
        billingCycle: cycle,
        monthToDate: {
          spend: (spend._sum.amountCharged ?? new Prisma.Decimal('0')).toString(),
          successfulEvents: eventCount,
        },
      });
    } catch (error) {
      console.error('[wallet/balance]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load wallet balance' } });
    }
  });

  // GET /api/v1/wallet/transactions
  router.get('/transactions', async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;

      // Determine wallet: org or user
      let wallet = null;
      if (auth.orgId && auth.orgId.length > 0) {
        wallet = await prisma.wallet.findUnique({ where: { orgId: auth.orgId } });
      } else {
        wallet = await prisma.wallet.findUnique({ where: { userId: auth.userId } });
      }

      if (!wallet) {
        response.json({ transactions: [] });
        return;
      }

      // Fetch last 50 transactions
      const transactions = await prisma.transaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, type: true, amount: true, status: true, createdAt: true },
      });

      response.json({
        transactions: transactions.map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount.toString(),
          status: t.status,
          createdAt: t.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error('[wallet/transactions]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load transactions' } });
    }
  });

  return router;
}
