import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';

const HERE = dirname(fileURLToPath(import.meta.url));

let cachedSpec: unknown | null = null;

function loadOpenApiSpec(): unknown {
  if (cachedSpec) return cachedSpec;
  // Prefer dist-adjacent copy; fall back to repo openapi/ during tsx dev.
  const candidates = [
    join(HERE, '../openapi/qlix-developer-v1.json'), // dist/routes → dist/openapi
    join(HERE, '../../openapi/qlix-developer-v1.json'), // src/routes → openapi (tsx) or dist → openapi
    join(process.cwd(), 'openapi/qlix-developer-v1.json'),
  ];
  for (const path of candidates) {
    try {
      cachedSpec = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      return cachedSpec;
    } catch {
      // try next
    }
  }
  throw new Error('OpenAPI spec not found');
}

/**
 * Serves the curated Developer API OpenAPI document (public, no auth).
 */
export function createOpenApiRouter(): Router {
  const router = Router();

  router.get('/openapi.json', (_request: Request, response: Response) => {
    try {
      const spec = loadOpenApiSpec();
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
