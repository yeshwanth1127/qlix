import 'dotenv/config';
import express from 'express';
import { createApiRouter } from './api.js';
import { resumeSavedSessions } from './sessionManager.js';

const REQUIRED = ['PORT', 'QLIX_URL', 'SERVICE_SECRET'];

function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.error('[qlix-whatsapp] Missing required env:', missing.join(', '));
    process.exit(1);
  }
}

let httpServer = null;

async function main() {
  validateEnv();

  const port = Number(process.env.PORT) || 3939;

  console.log('────────────────────────────────────────');
  console.log('  Qlix WhatsApp Service v2 (multi-tenant)');
  console.log(`  HTTP port: ${port}`);
  console.log(`  Qlix URL:  ${process.env.QLIX_URL}`);
  console.log('────────────────────────────────────────');

  const app = express();
  app.use(createApiRouter());

  httpServer = app.listen(port, () => {
    console.log(`[qlix-whatsapp] HTTP listening on :${port}`);
    void resumeSavedSessions();
  });

  const shutdown = async (signal) => {
    console.log(`[qlix-whatsapp] ${signal} — shutting down`);
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[qlix-whatsapp] Fatal:', err);
  process.exit(1);
});
