import type { Express } from 'express';
import type { WebAuthnEnvironment } from '../config/loadEnvironmentConfig.js';
import { createAuthRouter } from '../routes/createAuthRouter.js';
import { createDashboardRouter } from '../routes/createDashboardRouter.js';
import { createHealthRouter } from '../routes/createHealthRouter.js';
import { createOrganizationRouter } from '../routes/createOrganizationRouter.js';
import { createPassportsRouter } from '../routes/createPassportsRouter.js';
import { createCredentialsRouter } from '../routes/createCredentialsRouter.js';
import { createApiKeysRouter } from '../routes/createApiKeysRouter.js';
import { createWebauthnRouter } from '../routes/createWebauthnRouter.js';
import { createAgentsRouter } from '../routes/createAgentsRouter.js';
import { createAgentChatRouter } from '../routes/createAgentChatRouter.js';
import { createActionsRouter } from '../routes/createActionsRouter.js';
import { createJitRouter } from '../routes/createJitRouter.js';
import { createInternalRouter, createWhatsAppRouter } from '../routes/createWhatsAppRouter.js';
import { createPublicPassportRouter } from '../routes/createPublicPassportRouter.js';
import { createInferenceProxyRouter } from '../routes/createInferenceProxyRouter.js';
import { createInferenceCatalogRouter } from '../routes/createInferenceCatalogRouter.js';
import { createAutoRoutingInfoRouter } from '../routes/createAutoRoutingInfoRouter.js';
import { createAiBrainRouter } from '../routes/createAiBrainRouter.js';
import { createTeamsRouter } from '../routes/createTeamsRouter.js';
import { createConnectorsRouter } from '../routes/createConnectorsRouter.js';
import { createMcpRouter } from '../routes/createMcpRouter.js';
import { createNlBuilderHistoryRouter } from '../routes/createNlBuilderHistoryRouter.js';
import { createNlBuilderSessionsRouter } from '../routes/createNlBuilderSessionsRouter.js';
import { createBuilderCanvasRouter } from '../routes/createBuilderCanvasRouter.js';
import { createBillingRouter } from '../billings/routes/createBillingRouter.js';
import { createBillingIngestRouter } from '../billings/routes/createBillingIngestRouter.js';
import { createAdminBillingRouter } from '../billings/routes/createAdminBillingRouter.js';
import { createUsageRouter } from '../routes/createUsageRouter.js';
import { createWalletRouter } from '../routes/createWalletRouter.js';
import { createMobileRouter } from '../routes/createMobileRouter.js';
import { createJobsRouter } from '../routes/createJobsRouter.js';
import { createInternalJobsRouter } from '../routes/createInternalJobsRouter.js';
import { createSandboxRouter } from '../routes/createSandboxRouter.js';
import { createWaitlistRouter } from '../routes/createWaitlistRouter.js';
import { createHomepageVisitsRouter } from '../routes/createHomepageVisitsRouter.js';
import { createEmployeesRouter } from '../routes/createEmployeesRouter.js';
import { createSkillsRouter } from '../routes/createSkillsRouter.js';
import { createEmployeeSchedulesRouter } from '../routes/createEmployeeSchedulesRouter.js';
import { createSchedulesRouter } from '../routes/createSchedulesRouter.js';
import { createInternalSchedulesRouter } from '../routes/createInternalSchedulesRouter.js';
import { createComplianceRouter } from '../routes/createComplianceRouter.js';
import { createSlackRouter } from '../routes/createSlackRouter.js';
import { createTelegramRouter } from '../routes/createTelegramRouter.js';
import { createVcVerifyRouter } from '../routes/createVcVerifyRouter.js';
import { createChannelDefaultsRouter } from '../routes/createChannelDefaultsRouter.js';
import { createOpenApiRouter } from '../routes/createOpenApiRouter.js';
import { createConversationsRouter } from '../routes/createConversationsRouter.js';
import { createAssessmentToolRoutes } from '../assessment/assessmentToolRoutes.js';
import { createAssessmentRoutes } from '../assessment/assessment.routes.js';
import { createPluginsRouter } from '../plugins/plugins.routes.js';
import { createDeviceIngestRoutes } from '../assessment/deviceIngest.routes.js';
import { createContextToolRoutes } from '../context/contextToolRoutes.js';
import { createGtmRouter } from '../gtm/gtm.routes.js';

export interface RegisterApiRoutesOptions {
  webAuthn: WebAuthnEnvironment;
}

/**
 * Mounts versioned API routers under `/api/v1`.
 */
export function registerApiRoutes(application: Express, options: RegisterApiRoutesOptions): void {
  application.use('/api/v1', createOpenApiRouter());
  application.use('/api/v1/auth', createAuthRouter());
  application.use('/api/v1/dashboard', createDashboardRouter());
  application.use('/api/v1/passports', createPassportsRouter());
  application.use('/api/v1/credentials', createCredentialsRouter());
  application.use('/api/v1/api-keys', createApiKeysRouter());
  application.use('/api/v1/organization', createOrganizationRouter());
  application.use('/api/v1/billing', createBillingRouter());
  application.use('/api/v1/billing/ingest', createBillingIngestRouter());
  application.use('/api/v1/admin/billing', createAdminBillingRouter());
  application.use('/api/v1/webauthn', createWebauthnRouter(options.webAuthn));
  application.use('/api/v1/agents', createAgentsRouter());
  application.use('/api/v1/agents', createAgentChatRouter());
  application.use('/api/v1/agents', createInferenceProxyRouter());
  application.use('/api/v1/agents', createContextToolRoutes());
  application.use('/api/v1/agents', createAssessmentToolRoutes());
  application.use('/api/v1/inference', createInferenceCatalogRouter());
  application.use('/api/v1/inference', createAutoRoutingInfoRouter());
  application.use('/api/v1/ai-brain', createAiBrainRouter());
  application.use('/api/v1/teams', createTeamsRouter());
  application.use('/api/v1/conversations', createConversationsRouter());
  // Must be registered before /api/v1/assessment below — Express matches routers by
  // registration order, not specificity, and the general assessment router applies a
  // blanket dashboard-auth middleware that would otherwise intercept every request
  // under /api/v1/assessment/device/* (device-token auth, no dashboard login) first.
  application.use('/api/v1/assessment/device', createDeviceIngestRoutes());
  application.use('/api/v1/assessment', createAssessmentRoutes());
  application.use('/api/v1/plugins', createPluginsRouter());
  application.use('/api/v1/gtm', createGtmRouter());
  application.use('/api/v1/connectors', createConnectorsRouter());
  application.use('/api/v1/mcp', createMcpRouter());
  application.use('/api/v1/nl-builder/history', createNlBuilderHistoryRouter());
  application.use('/api/v1/nl-builder/sessions', createNlBuilderSessionsRouter());
  application.use('/api/v1/builder/canvases', createBuilderCanvasRouter());
  application.use('/api/v1/actions', createActionsRouter());
  application.use('/api/v1/jit', createJitRouter());
  application.use('/api/v1/usage', createUsageRouter());
  application.use('/api/v1/wallet', createWalletRouter());
  application.use('/api/v1/whatsapp', createWhatsAppRouter());
  application.use('/api/v1/internal', createInternalRouter());
  application.use('/api/v1/internal/jobs', createInternalJobsRouter());
  application.use('/api/v1/jobs', createJobsRouter());
  application.use('/api/v1/internal/schedules', createInternalSchedulesRouter());
  application.use('/api/v1/schedules', createSchedulesRouter());
  application.use('/api/v1/sandbox', createSandboxRouter());
  application.use('/api/v1/waitlist', createWaitlistRouter());
  application.use('/api/v1/employees', createEmployeesRouter());
  application.use('/api/v1/employee-schedules', createEmployeeSchedulesRouter());
  application.use('/api/v1/skills', createSkillsRouter());
  application.use('/api/v1/compliance', createComplianceRouter());
  application.use('/api/v1/slack', createSlackRouter());
  application.use('/api/integrations/telegram', createTelegramRouter());
  application.use('/api/v1/telegram', createTelegramRouter());
  application.use('/api/v1/verify', createVcVerifyRouter());
  application.use('/api/v1/channel-defaults', createChannelDefaultsRouter());
  application.use('/api/v1/homepage-visits', createHomepageVisitsRouter());
  application.use(createPublicPassportRouter());
  application.use('/api/v1/mobile', createMobileRouter());
  application.use('/api/v1', createHealthRouter());
}
