import { loadEnvironmentConfig } from './config/loadEnvironmentConfig.js';
import { createHttpApplication } from './http/createHttpApplication.js';
import { startHttpServer } from './http/startHttpServer.js';

const config = loadEnvironmentConfig();
const application = createHttpApplication({
  nodeEnvironment: config.nodeEnvironment,
  corsOrigins: config.corsOrigins,
  frontendUrl: config.frontendUrl,
  webAuthn: config.webAuthn,
});

startHttpServer(application, { port: config.httpPort });
