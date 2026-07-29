import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requireServiceSecret } from './serviceAuth.js';

// Sandbox file store: the backend uploads a generated report PDF here (server-to-server,
// secret-guarded) and later streams it back to the user's browser via its own
// /api/v1/sandbox/:id proxy. Files are capability-addressed (unguessable id) and expire.

const SANDBOX_DIR = process.env.SANDBOX_DIR?.trim() || path.join(os.tmpdir(), 'qlix-sandbox');
const TTL_HOURS = Number(process.env.SANDBOX_TTL_HOURS) || 168; // 7 days
const MAX_BYTES = 50 * 1024 * 1024; // ~25-page PDF with images

function safeName(name) {
  return String(name || 'report').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'report';
}

async function readMeta(id) {
  try {
    return JSON.parse(await fsp.readFile(path.join(SANDBOX_DIR, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

async function removeEntry(id) {
  await fsp.rm(path.join(SANDBOX_DIR, id), { force: true }).catch(() => {});
  await fsp.rm(path.join(SANDBOX_DIR, `${id}.json`), { force: true }).catch(() => {});
}

async function sweep() {
  try {
    const now = Date.now();
    for (const name of await fsp.readdir(SANDBOX_DIR)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      const meta = await readMeta(id);
      if (meta?.expiresAt && meta.expiresAt < now) await removeEntry(id);
    }
  } catch {
    /* dir may not exist yet */
  }
}

export function createSandboxRouter() {
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref?.();

  const router = express.Router();

  // Upload (backend -> here). Raw binary body so the global express.json(2mb) is bypassed.
  router.post('/', requireServiceSecret, express.raw({ type: () => true, limit: '60mb' }), async (req, res) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ ok: false, error: 'empty body' });
      return;
    }
    if (body.length > MAX_BYTES) {
      res.status(413).json({ ok: false, error: 'file too large' });
      return;
    }
    const id = crypto.randomBytes(16).toString('hex');
    const fileName = safeName(req.header('X-File-Name'));
    const contentType = req.header('X-Content-Type') || 'application/pdf';
    const expiresAt = Date.now() + TTL_HOURS * 3600 * 1000;
    try {
      await fsp.writeFile(path.join(SANDBOX_DIR, id), body);
      await fsp.writeFile(
        path.join(SANDBOX_DIR, `${id}.json`),
        JSON.stringify({ id, fileName, contentType, size: body.length, expiresAt }),
      );
    } catch (err) {
      console.error('[qlix-mcp] sandbox store failed', err);
      res.status(500).json({ ok: false, error: 'store failed' });
      return;
    }
    res.json({ ok: true, id, fileName, expiresAt });
  });

  // Download (backend proxy -> here). Secret-guarded: the mcp service is internal-only.
  router.get('/:id', requireServiceSecret, async (req, res) => {
    const id = String(req.params.id);
    if (!/^[a-f0-9]{32}$/.test(id)) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    const meta = await readMeta(id);
    const filePath = path.join(SANDBOX_DIR, id);
    if (!meta || (meta.expiresAt && meta.expiresAt < Date.now()) || !fs.existsSync(filePath)) {
      res.status(404).json({ ok: false, error: 'not found or expired' });
      return;
    }
    res.setHeader('Content-Type', meta.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${meta.fileName || 'report.pdf'}"`);
    if (meta.size) res.setHeader('Content-Length', String(meta.size));
    fs.createReadStream(filePath).pipe(res);
  });

  return router;
}
