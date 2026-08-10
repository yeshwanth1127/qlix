import 'dotenv/config';
import express from 'express';
import { createMcpRouter } from './mcpHttp.js';
import { TOOL_CATALOG, executeTool } from './tools.js';
import { JOBS_TOOL_CATALOG, executeJobsTool } from './jobsTools.js';
import { SCHEDULE_TOOL_CATALOG, executeScheduleTool } from './scheduleTools.js';
import { createScrapeRouter } from './scrapeRouter.js';
import { createSandboxRouter } from './sandboxRouter.js';
import { requireServiceSecret } from './serviceAuth.js';

const REQUIRED = ['PORT', 'QLIX_URL', 'SERVICE_SECRET'];

function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.error('[qlix-mcp] Missing required env:', missing.join(', '));
    process.exit(1);
  }
}

async function main() {
  validateEnv();
  const port = Number(process.env.PORT) || 3940;

  console.log('────────────────────────────────────────');
  console.log('  Qlix MCP Service v1');
  console.log(`  HTTP port: ${port}`);
  console.log(`  Qlix URL:  ${process.env.QLIX_URL}`);
  console.log(`  Mock mode: ${process.env.GMB_SCRAPER_MOCK === '1' ? 'yes' : 'no'}`);
  console.log('────────────────────────────────────────');

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'qlix-mcp' });
  });

  const leadsMcp = createMcpRouter({
    name: 'qlix-leads',
    tools: TOOL_CATALOG,
    execute: executeTool,
  });
  app.post('/mcp', requireServiceSecret, leadsMcp);

  const jobsMcp = createMcpRouter({
    name: 'qlix-jobs',
    tools: JOBS_TOOL_CATALOG,
    execute: executeJobsTool,
  });
  app.post('/mcp-jobs', requireServiceSecret, jobsMcp);

  const scheduleMcp = createMcpRouter({
    name: 'qlix-schedule',
    tools: SCHEDULE_TOOL_CATALOG,
    execute: executeScheduleTool,
  });
  app.post('/mcp-schedule', requireServiceSecret, scheduleMcp);

  app.use('/scrape', createScrapeRouter());
  app.use('/sandbox', createSandboxRouter());

  const host = process.env.MCP_BIND_HOST?.trim() || '127.0.0.1';
  app.listen(port, host, () => {
    console.log(`[qlix-mcp] listening on ${host}:${port}`);
  });
}

main().catch((err) => {
  console.error('[qlix-mcp] Fatal:', err);
  process.exit(1);
});
