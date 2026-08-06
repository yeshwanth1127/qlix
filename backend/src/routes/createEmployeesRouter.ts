import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { employeeRoleSlugSchema } from '../employees/manifestSchema.js';
import {
  EmployeeHireForbiddenError,
  EmployeeNotFoundError,
  EmployeesService,
} from '../employees/employees.service.js';
import { getRoleCatalogEntry, getRoleManifest, listRoleCatalog } from '../employees/packResolver.js';

const hireSchema = z.object({
  roleSlug: employeeRoleSlugSchema,
  name: z.string().trim().min(1).max(120).optional(),
  limitedMode: z.boolean().optional(),
  selectedPlatformIds: z.array(z.string().min(1)).optional(),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
});

const preflightSchema = z.object({
  roleSlug: employeeRoleSlugSchema,
  selectedPlatformIds: z.array(z.string().min(1)).optional(),
});

export function createEmployeesRouter(): Router {
  const router = Router();
  const service = new EmployeesService();

  router.get('/roles', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const workspaceOrgId = await service.resolveWorkspaceOrgId(auth.userId);
      const roles = await listRoleCatalog(workspaceOrgId);
      response.json({ roles });
    } catch (err) {
      console.error('employees roles list error', err);
      response.status(500).json({
        error: { code: 'roles_list_failed', message: 'Failed to load employee roles' },
      });
    }
  });

  router.get('/roles/:slug', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const slug = String(request.params.slug);
      const workspaceOrgId = await service.resolveWorkspaceOrgId(auth.userId);
      const role = await getRoleCatalogEntry(workspaceOrgId, slug);
      if (!role) {
        response.status(404).json({ error: { code: 'not_found', message: 'Role not found' } });
        return;
      }
      const manifest = getRoleManifest(slug);
      response.json({ role, manifest });
    } catch (err) {
      console.error('employees role get error', err);
      response.status(500).json({
        error: { code: 'role_get_failed', message: 'Failed to load employee role' },
      });
    }
  });

  router.post('/preflight', authenticateUser(true), async (request: Request, response: Response) => {
    const body = preflightSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({ error: { code: 'validation_error', message: 'Invalid body' } });
      return;
    }
    try {
      const auth = request.auth!;
      const preflight = await service.preflight(
        auth.userId,
        body.data.roleSlug,
        body.data.selectedPlatformIds ?? [],
      );
      response.json({ preflight });
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      console.error('employees preflight error', err);
      response.status(500).json({
        error: { code: 'preflight_failed', message: 'Failed to preflight employee hire' },
      });
    }
  });

  router.get('/', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const engagements = await service.listEngagements(auth.userId);
      response.json({ engagements });
    } catch (err) {
      console.error('employees list error', err);
      response.status(500).json({
        error: { code: 'employees_list_failed', message: 'Failed to list employees' },
      });
    }
  });

  router.get('/:id', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const engagement = await service.getEngagement(auth.userId, String(request.params.id));
      response.json({ engagement });
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      console.error('employees get error', err);
      response.status(500).json({
        error: { code: 'employee_get_failed', message: 'Failed to load employee' },
      });
    }
  });

  router.post('/hire', authenticateUser(true), async (request: Request, response: Response) => {
    const body = hireSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({ error: { code: 'validation_error', message: 'Invalid body' } });
      return;
    }
    try {
      const auth = request.auth!;
      const result = await service.hire({
        userId: auth.userId,
        roleSlug: body.data.roleSlug,
        name: body.data.name,
        limitedMode: body.data.limitedMode,
        selectedPlatformIds: body.data.selectedPlatformIds,
        configOverrides: body.data.configOverrides,
      });
      response.status(201).json(result);
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      if (err instanceof EmployeeHireForbiddenError) {
        response.status(403).json({ error: { code: 'hire_forbidden', message: err.message } });
        return;
      }
      console.error('employees hire error', err);
      response.status(500).json({
        error: { code: 'hire_failed', message: 'Failed to hire employee' },
      });
    }
  });

  router.post('/:id/suspend', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const engagement = await service.suspend(auth.userId, String(request.params.id));
      response.json({ engagement });
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      if (err instanceof EmployeeHireForbiddenError) {
        response.status(403).json({ error: { code: 'forbidden', message: err.message } });
        return;
      }
      console.error('employees suspend error', err);
      response.status(500).json({
        error: { code: 'suspend_failed', message: 'Failed to suspend employee' },
      });
    }
  });

  router.post('/:id/reactivate', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const engagement = await service.reactivate(auth.userId, String(request.params.id));
      response.json({ engagement });
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      if (err instanceof EmployeeHireForbiddenError) {
        response.status(403).json({ error: { code: 'forbidden', message: err.message } });
        return;
      }
      console.error('employees reactivate error', err);
      response.status(500).json({
        error: { code: 'reactivate_failed', message: 'Failed to reactivate employee' },
      });
    }
  });

  return router;
}
