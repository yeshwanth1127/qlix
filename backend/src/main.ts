import { loadEnvironmentConfig } from './config/loadEnvironmentConfig.js';
import { createHttpApplication } from './http/createHttpApplication.js';
import { startHttpServer } from './http/startHttpServer.js';
import { ensureQlixLeadsMcpAllOrgs } from './leads/ensureQlixLeadsMcp.js';
import { ensureQlixJobsMcpAllOrgs } from './jobs/ensureQlixJobsMcp.js';
import { ensureQlixScheduleMcpAllOrgs } from './schedules/ensureQlixScheduleMcp.js';
import { ensureDefaultAgentScopesAllAgents } from './agents/ensureDefaultAgentScopes.js';
import { startProvisioningWatchdog } from './cloudRunners/provisioningWatchdog.js';
import { startBackgroundScheduler } from './jobs/backgroundScheduler.js';

const config = loadEnvironmentConfig();
const application = createHttpApplication({
  nodeEnvironment: config.nodeEnvironment,
  corsOrigins: config.corsOrigins,
  frontendUrl: config.frontendUrl,
  webAuthn: config.webAuthn,
});

startHttpServer(application, { port: config.httpPort });

void ensureQlixLeadsMcpAllOrgs().catch((err) => {
  console.error('[leads-mcp] boot registration failed', err);
});

void ensureQlixJobsMcpAllOrgs().catch((err) => {
  console.error('[jobs-mcp] boot registration failed', err);
});

void ensureQlixScheduleMcpAllOrgs()
  .then(() => ensureDefaultAgentScopesAllAgents())
  .catch((err) => {
    console.error('[schedule-mcp/default-scopes] boot registration failed', err);
  });

void startProvisioningWatchdog().catch((err) => {
  console.error('[provisionWatchdog] startup failed', err);
});

startBackgroundScheduler();
