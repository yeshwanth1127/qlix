import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';

const HERE = dirname(fileURLToPath(import.meta.url));

let cachedSpec: Record<string, unknown> | null = null;

function loadOpenApiSpec(): Record<string, unknown> {
  if (cachedSpec) return cachedSpec;
  // Prefer dist-adjacent copy; fall back to repo openapi/ during tsx dev.
  const candidates = [
    join(HERE, '../openapi/qlix-developer-v1.json'), // dist/routes → dist/openapi
    join(HERE, '../../openapi/qlix-developer-v1.json'), // src/routes → openapi (tsx) or dist → openapi
    join(process.cwd(), 'openapi/qlix-developer-v1.json'),
  ];
  for (const path of candidates) {
    try {
      cachedSpec = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      return cachedSpec;
    } catch {
      // try next
    }
  }
  throw new Error('OpenAPI spec not found');
}

function firstForwardedValue(raw: string | undefined): string {
  return (raw ?? '').split(',')[0]?.trim() ?? '';
}

/** Absolute `/api/v1` root for this deployment, derived from the incoming request. */
export function absoluteDeveloperApiRoot(request: Request): string {
  const proto =
    firstForwardedValue(request.get('x-forwarded-proto')) ||
    request.protocol ||
    'https';
  const host =
    firstForwardedValue(request.get('x-forwarded-host')) ||
    firstForwardedValue(request.get('host'));
  if (!host) return '/api/v1';
  return `${proto}://${host}/api/v1`;
}

function specForRequest(request: Request): Record<string, unknown> {
  const spec = structuredClone(loadOpenApiSpec()) as Record<string, unknown>;
  spec.servers = [
    { url: absoluteDeveloperApiRoot(request), description: 'This deployment' },
    { url: '/api/v1', description: 'Versioned API root (relative)' },
  ];
  return spec;
}

/**
 * Serves the curated Developer API OpenAPI document (public, no auth).
 */
export function createOpenApiRouter(): Router {
  const router = Router();

  router.get('/openapi.json', (request: Request, response: Response) => {
    try {
      const spec = specForRequest(request);
      response.setHeader('Cache-Control', 'public, max-age=60');
      response.json(spec);
    } catch (err) {
      console.error('[openapi] failed to load spec', err);
      response.status(500).json({
        error: { code: 'internal_error', message: 'OpenAPI specification unavailable' },
      });
    }
  });

  return router;
}
