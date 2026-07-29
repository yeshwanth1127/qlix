import express from 'express';
import * as qlix from './qlix-client.js';
import { runScrapeJob } from './gmbScraper.js';
import { requireServiceSecret } from './serviceAuth.js';

export function createScrapeRouter() {
  const router = express.Router();
  router.use(requireServiceSecret);

  router.post('/', async (req, res) => {
    const { campaignId, orgId } = req.body || {};
    if (!campaignId || !orgId) {
      res.status(400).json({ ok: false, error: 'campaignId and orgId required' });
      return;
    }
    res.json({ ok: true, queued: true });
    void runScrapeJob({
      campaignId,
      orgId,
      getCampaign: qlix.getCampaign,
      completeScrape: qlix.completeScrape,
    });
  });

  return router;
}
