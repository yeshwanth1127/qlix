import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { resolveApiKeyRouteAccess } from '../lib/apiKeyScopes.js';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

type OpenApiOperation = {
  operationId?: string;
  'x-qlix-scopes'?: unknown;
};

type OpenApiSpec = {
  paths?: Record<string, Record<string, OpenApiOperation | undefined>>;
};

function loadSpec(): OpenApiSpec {
  const raw = readFileSync(join(process.cwd(), 'openapi/qlix-developer-v1.json'), 'utf8');
  return JSON.parse(raw) as OpenApiSpec;
}

function sampleUrl(openApiPath: string): string {
  const filled = openApiPath.replace(/\{[^}]+\}/g, 'op_sample');
  return `/api/v1${filled}`;
}

function scopesOf(op: OpenApiOperation): string[] {
  const raw = op['x-qlix-scopes'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

describe('developer OpenAPI spec vs API-key allowlist', () => {
  const spec = loadSpec();
  const paths = spec.paths ?? {};

  it('declares paths', () => {
    assert.ok(Object.keys(paths).length > 0);
  });

  it('every operation has x-qlix-scopes and is allowlisted', () => {
    const failures: string[] = [];

    for (const [path, item] of Object.entries(paths)) {
      if (!item || typeof item !== 'object') continue;
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!op || typeof op !== 'object') continue;
        const label = `${method.toUpperCase()} ${path} (${op.operationId ?? 'no-id'})`;
        const hasScopeField = Array.isArray(op['x-qlix-scopes']);
        const scopes = scopesOf(op);
        if (!hasScopeField) {
          failures.push(`${label}: missing x-qlix-scopes`);
          continue;
        }
        const access = resolveApiKeyRouteAccess(method.toUpperCase(), sampleUrl(path));
        if (!access.allowed) {
          failures.push(`${label}: not allowlisted (${sampleUrl(path)})`);
          continue;
        }
        const expected = [...access.scopes].sort();
        const documented = [...scopes].sort();
        if (JSON.stringify(expected) !== JSON.stringify(documented)) {
          failures.push(
            `${label}: scope mismatch allowlist=${expected.join(',')} spec=${documented.join(',')}`,
          );
        }
      }
    }

    assert.deepEqual(failures, []);
  });
});
