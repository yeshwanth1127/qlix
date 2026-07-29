import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { fetchSandboxFile } from '../sandbox/sandboxClient.js';

/** Tighter than the global default — this route is unauthenticated by design (capability link). */
function sandboxDownloadRateLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.SANDBOX_DOWNLOAD_RATE_LIMIT_PER_MINUTE) || 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.GLOBAL_RATE_LIMIT_DISABLED === '1',
    message: { error: { code: 'rate_limited', message: 'Too many downloads. Please try again shortly.' } },
  });
}

/**
 * Public download proxy for sandbox files (generated report PDFs). The id is an
 * unguessable capability token; the bytes live in the internal qlix-mcp service and
 * are streamed through here so that service never needs public exposure. There's no
 * per-user ownership check by design (recipients open this link from WhatsApp without
 * a session) — the id's 128 bits of entropy is the access control. Every access is
 * logged so there's at least an audit trail of who (by IP) fetched what, when.
 */
export function createSandboxRouter(): Router {
  const router = Router();

  router.get('/:id', sandboxDownloadRateLimiter(), async (request: Request, response: Response) => {
    const id = String(request.params.id);
    if (!/^[a-f0-9]{32}$/.test(id)) {
      response.status(404).json({ error: { code: 'not_found', message: 'File not found' } });
      return;
    }
    try {
      const file = await fetchSandboxFile(id);
      if (!file) {
        console.warn(`[sandbox-audit] miss id=${id} ip=${request.ip}`);
        response.status(404).json({ error: { code: 'not_found', message: 'File not found or expired' } });
        return;
      }
      console.log(`[sandbox-audit] download id=${id} file=${file.fileName} ip=${request.ip}`);
      response.setHeader('Content-Type', file.contentType);
      response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      response.setHeader('Cache-Control', 'private, no-store');
      response.send(file.body);
    } catch (err) {
      console.error('sandbox download', err);
      response.status(502).json({ error: { code: 'sandbox_unavailable', message: 'Download unavailable' } });
    }
  });

  return router;
}
