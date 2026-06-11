import type { Express } from 'express';
import type { WebAuthnEnvironment } from '../config/loadEnvironmentConfig.js';
import { createAuthRouter } from '../routes/createAuthRouter.js';
import { createDashboardRouter } from '../routes/createDashboardRouter.js';
import { createHealthRouter } from '../routes/createHealthRouter.js';
import { createOrganizationRouter } from '../routes/createOrganizationRouter.js';
import { createPassportsRouter } from '../routes/createPassportsRouter.js';
import { createWebauthnRouter } from '../routes/createWebauthnRouter.js';
import { createAgentsRouter } from '../routes/createAgentsRouter.js';
import { createAgentChatRouter } from '../routes/createAgentChatRouter.js';
import { createActionsRouter } from '../routes/createActionsRouter.js';
import { createJitRouter } from '../routes/createJitRouter.js';
import { createInternalRouter, createWhatsAppRouter } from '../routes/createWhatsAppRouter.js';
import { createPublicPassportRouter } from '../routes/createPublicPassportRouter.js';
import { createInferenceProxyRouter } from '../routes/createInferenceProxyRouter.js';
import { createInferenceCatalogRouter } from '../routes/createInferenceCatalogRouter.js';
import { createAiBrainRouter } from '../routes/createAiBrainRouter.js';
import { createTeamsRouter } from '../routes/createTeamsRouter.js';
import { createConnectorsRouter } from '../routes/createConnectorsRouter.js';
import { createMcpRouter } from '../routes/createMcpRouter.js';
import { createNlBuilderHistoryRouter } from '../routes/createNlBuilderHistoryRouter.js';
import { createBillingRouter } from '../billings/routes/createBillingRouter.js';
import { createBillingIngestRouter } from '../billings/routes/createBillingIngestRouter.js';
import { createAdminBillingRouter } from '../billings/routes/createAdminBillingRouter.js';
import { createUsageRouter } from '../routes/createUsageRouter.js';
import { createWalletRouter } from '../routes/createWalletRouter.js';
import { createMobileRouter } from '../routes/createMobileRouter.js';

export interface RegisterApiRoutesOptions {
  webAuthn: WebAuthnEnvironment;
}

/**
 * Mounts versioned API routers under `/api/v1`.
 */
export function registerApiRoutes(application: Express, options: RegisterApiRoutesOptions): void {
  application.use('/api/v1/auth', createAuthRouter());
  application.use('/api/v1/dashboard', createDashboardRouter());
  application.use('/api/v1/passports', createPassportsRouter());
  application.use('/api/v1/organization', createOrganizationRouter());
  application.use('/api/v1/billing', createBillingRouter());
  application.use('/api/v1/billing/ingest', createBillingIngestRouter());
  application.use('/api/v1/admin/billing', createAdminBillingRouter());
  application.use('/api/v1/webauthn', createWebauthnRouter(options.webAuthn));
  application.use('/api/v1/agents', createAgentsRouter());
  application.use('/api/v1/agents', createAgentChatRouter());
  application.use('/api/v1/agents', createInferenceProxyRouter());
  application.use('/api/v1/inference', createInferenceCatalogRouter());
  application.use('/api/v1/ai-brain', createAiBrainRouter());
  application.use('/api/v1/teams', createTeamsRouter());
  application.use('/api/v1/connectors', createConnectorsRouter());
  application.use('/api/v1/mcp', createMcpRouter());
  application.use('/api/v1/nl-builder/history', createNlBuilderHistoryRouter());
  application.use('/api/v1/actions', createActionsRouter());
  application.use('/api/v1/jit', createJitRouter());
  application.use('/api/v1/usage', createUsageRouter());
  application.use('/api/v1/wallet', createWalletRouter());
  application.use('/api/v1/whatsapp', createWhatsAppRouter());
  application.use('/api/v1/internal', createInternalRouter());
  application.use(createPublicPassportRouter());
  application.use('/api/v1/mobile', createMobileRouter());
  application.use('/api/v1', createHealthRouter());
}
