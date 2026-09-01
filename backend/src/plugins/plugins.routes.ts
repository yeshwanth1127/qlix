import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import {
  disablePlugin,
  enablePlugin,
  listPluginsForOrg,
  PluginValidationError,
  UnknownPluginError,
} from './plugins.service.js';

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => void handler(request, response).catch(next);
}

export function createPluginsRouter(): Router {
  const router = Router();
  router.use(authenticateUser(true), requireSubscriptionAccess);

  router.get('/', asyncRoute(async (request, response) => {
    const plugins = await listPluginsForOrg(request.auth!.orgId);
    response.json({ plugins });
  }));

  router.post('/:pluginId/enable', asyncRoute(async (request, response) => {
    try {
      const config = request.body?.config && typeof request.body.config === 'object'
        ? request.body.config as Record<string, unknown>
        : {};
      await enablePlugin(request.auth!.orgId, String(request.params.pluginId), request.auth!.userId, config);
    } catch (err) {
      if (err instanceof UnknownPluginError) {
        return void response.status(404).json({ error: { code: 'unknown_plugin', message: err.message } });
      }
      if (err instanceof PluginValidationError) {
        return void response.status(409).json({
          error: { code: err.code, message: err.message, problems: err.problems },
        });
      }
      throw err;
    }
    const plugins = await listPluginsForOrg(request.auth!.orgId);
    response.json({ plugins });
  }));

  router.post('/:pluginId/disable', asyncRoute(async (request, response) => {
    try {
      await disablePlugin(request.auth!.orgId, String(request.params.pluginId));
    } catch (err) {
      if (err instanceof UnknownPluginError) {
        return void response.status(404).json({ error: { code: 'unknown_plugin', message: err.message } });
      }
      throw err;
    }
    const plugins = await listPluginsForOrg(request.auth!.orgId);
    response.json({ plugins });
  }));

  return router;
}
