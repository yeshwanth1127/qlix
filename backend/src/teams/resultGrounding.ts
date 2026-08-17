/**
 * Contract-declared grounding.
 *
 * Every value a worker returns comes from exactly one of three places: it was **given** to the
 * dispatch (authoritative input or a prior Result handback), it was **discovered** by a tool the
 * dispatch actually called, or it came from nowhere. The third case is fabrication, and no amount
 * of key-name guessing tells the three apart — whether `founders[].name` must trace to the input
 * or may be discovered on the web is a property of the task, not of the word "founders".
 *
 * So the dispatch's own outputContract declares it, per field:
 *
 *   { "type": "array", "items": { "type": "object", "properties": {
 *       "name":      { "type": "string", "grounding": "input"   },
 *       "sourceUrl": { "type": "string", "grounding": "tool"    },
 *       "standing":  { "type": "string", "grounding": "derived" } } } }
 *
 * This module is the engine that reads those annotations and checks a payload against them. It
 * knows nothing about leads, founders, or any other domain: a contract that declares nothing is
 * checked for nothing, and any new use case adapts by describing its own output.
 */

/**
 * - `input`   — must appear in what the dispatch was given (authoritative input, prior handbacks).
 * - `tool`    — must appear in a result returned by a tool this dispatch actually called.
 * - `derived` — reasoning over the other two; unconstrained, and exempt from the heuristic checks.
 */
export type GroundingMode = 'input' | 'tool' | 'derived';

const MODES = new Set<string>(['input', 'tool', 'derived']);

/** Canonical payload path, e.g. `findings.founders[].name`. */
type CanonicalPath = string;

interface Segment {
  key: string;
  arrayDepth: number;
}

interface FoundValue {
  value: unknown;
  /** Concrete path with array indices resolved, e.g. `findings.founders[0].name`. */
  path: string;
}

/**
 * Collect every grounding annotation in a contract, keyed by the payload path it governs.
 * Schemas are read loosely — `type` may be absent, as the planner often omits it.
 */
export function groundingPaths(
  schema: unknown,
  path = '',
  out = new Map<CanonicalPath, GroundingMode>(),
): Map<CanonicalPath, GroundingMode> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return out;
  const node = schema as Record<string, unknown>;

  const mode = node.grounding;
  if (path && typeof mode === 'string' && MODES.has(mode)) {
    out.set(path, mode as GroundingMode);
  }

  const properties = node.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
      groundingPaths(child, path ? `${path}.${key}` : key, out);
    }
  }
  if (node.items) groundingPaths(node.items, `${path}[]`, out);

  return out;
}

function parsePath(path: CanonicalPath): Segment[] {
  return path
    .split('.')
    .filter(Boolean)
    .map((part) => {
      let key = part;
      let arrayDepth = 0;
      while (key.endsWith('[]')) {
        key = key.slice(0, -2);
        arrayDepth += 1;
      }
      return { key, arrayDepth };
    });
}

function descendArrays(
  value: unknown,
  depth: number,
  path: string,
  visit: (value: unknown, path: string) => void,
): void {
  if (depth === 0) {
    visit(value, path);
    return;
  }
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => descendArrays(item, depth - 1, `${path}[${index}]`, visit));
}

function resolve(value: unknown, segments: Segment[], index: number, path: string, out: FoundValue[]): void {
  if (index >= segments.length) {
    out.push({ value, path });
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const segment = segments[index]!;
  const child = (value as Record<string, unknown>)[segment.key];
  if (child === undefined) return;
  const childPath = path ? `${path}.${segment.key}` : segment.key;
  descendArrays(child, segment.arrayDepth, childPath, (item, itemPath) =>
    resolve(item, segments, index + 1, itemPath, out),
  );
}

/** Every value the payload actually holds at a canonical path. */
export function valuesAtPath(payload: unknown, path: CanonicalPath): FoundValue[] {
  const out: FoundValue[] = [];
  resolve(payload, parsePath(path), 0, '', out);
  return out;
}

/** Groundable leaves. Objects cannot be traced to a source; their fields are annotated instead. */
function scalars(value: unknown): Array<string | number> {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(scalars);
  return [];
}

/** Compare URLs by their meaningful parts, so a trailing slash or casing is not a violation. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${pathname.toLowerCase()}${url.search}`;
  } catch {
    return trimmed.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

export interface GroundingCheck {
  payload: unknown;
  paths: Map<CanonicalPath, GroundingMode>;
  /** Authoritative input text plus prior Result handbacks — everything the dispatch was handed. */
  givenText: string;
  /** URLs returned by tools during this dispatch. */
  toolUrls: Set<string>;
  /**
   * Value-in-source test, injected so this engine stays free of domain rules. Luna-Teams passes
   * its own comparator, which normalises phone numbers before matching.
   */
  contains: (source: string, key: string, value: string | number) => boolean;
}

/** Human-readable violations, empty when the payload honours every declared grounding. */
export function groundingViolations(check: GroundingCheck): string[] {
  const problems: string[] = [];

  for (const [path, mode] of check.paths) {
    if (mode === 'derived') continue;
    const segments = parsePath(path);
    const key = segments[segments.length - 1]?.key ?? '';

    for (const found of valuesAtPath(check.payload, path)) {
      for (const value of scalars(found.value)) {
        if (mode === 'input') {
          if (!check.contains(check.givenText, key, value)) {
            problems.push(`${found.path} = ${JSON.stringify(value)} is not in anything this dispatch was given`);
          }
        } else if (!isKnownUrl(String(value), check.toolUrls)) {
          problems.push(`${found.path} = ${JSON.stringify(value)} was not returned by any tool in this dispatch`);
        }
      }
    }
  }

  return problems;
}

function isKnownUrl(value: string, toolUrls: Set<string>): boolean {
  if (toolUrls.size === 0) return false;
  const normalized = normalizeUrl(value);
  if (!normalized) return false;
  for (const known of toolUrls) {
    if (normalizeUrl(known) === normalized) return true;
  }
  return false;
}
