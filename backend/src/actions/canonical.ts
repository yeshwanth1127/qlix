/**
 * Deterministic JSON canonicalization for signed action payloads.
 *
 * The SDK and backend MUST agree on the exact byte sequence that gets signed.
 * We use stable, sorted-key JSON: object keys are sorted lexicographically at
 * every depth; arrays preserve order; primitives are JSON-encoded.
 *
 * NaN / Infinity / undefined are rejected — they have no canonical JSON form.
 */
export function canonicalize(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalize: non-finite number is not representable');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    const parts = value.map((v) => stringify(v));
    return `[${parts.join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  throw new Error(`canonicalize: unsupported value of type ${typeof value}`);
}
