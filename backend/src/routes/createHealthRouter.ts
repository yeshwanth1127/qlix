import { Router } from 'express';

export interface HealthCheckResponseBody {
  status: 'ok';
  service: string;
}

/**
 * Routes for load balancers and uptime checks.
 */
export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_request, response) => {
    const body: HealthCheckResponseBody = { status: 'ok', service: 'qlix-backend' };
    response.json(body);
  });

  return router;
}
