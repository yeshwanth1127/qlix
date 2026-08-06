import { Router, type Request, type Response } from 'express';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { buildComplianceExportPack } from '../compliance/complianceExport.service.js';

export function createComplianceRouter(): Router {
  const router = Router();

  router.get(
    '/export',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (req: Request, res: Response) => {
      const role = req.auth!.role;
      if (role === 'member') {
        res.status(403).json({
          error: { code: 'forbidden', message: 'Compliance export requires admin or owner' },
        });
        return;
      }
      const fromRaw = typeof req.query.from === 'string' ? Date.parse(req.query.from) : NaN;
      const toRaw = typeof req.query.to === 'string' ? Date.parse(req.query.to) : NaN;
      const format = typeof req.query.format === 'string' ? req.query.format : 'json';

      const pack = await buildComplianceExportPack({
        orgId: req.auth!.orgId,
        from: Number.isFinite(fromRaw) ? new Date(fromRaw) : undefined,
        to: Number.isFinite(toRaw) ? new Date(toRaw) : undefined,
      });

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="qlix-compliance-${pack.orgId.slice(0, 8)}.csv"`,
        );
        res.send(pack.csv);
        return;
      }

      res.json({
        generatedAt: pack.generatedAt,
        orgId: pack.orgId,
        actionLogCount: pack.actionLogCount,
        merkleRoot: pack.merkleRoot,
        jitSummary: pack.jitSummary,
        gatewayRoutes: pack.gatewayRoutes,
        csv: pack.csv,
      });
    },
  );

  return router;
}
