/**
 * SSRF guard for operator-supplied URLs that the backend fetches server-side: MCP endpoints,
 * and OAuth authorization/token/registration/metadata URLs discovered from a server's own
 * metadata. All of these are attacker-influenceable, so none may target internal infrastructure
 * (cloud metadata, loopback, private ranges).
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';

export class SsrfBlockedError extends Error {
  readonly code = 'ssrf_blocked';
}

/** True for loopback / private / link-local / ULA / CGNAT addresses we must never fetch. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

/** Normalize MCP endpoint URLs for trusted-url comparison (host + path, no trailing slash). */
function normalizeMcpEndpointUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname.replace(/\/$/, '') || '';
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return rawUrl.trim().replace(/\/$/, '');
  }
}

/** First-party qlix-mcp endpoints configured for this deployment (co-located on loopback). */
function trustedQlixMcpEndpoints(): Set<string> {
  const candidates = [
    process.env.QLIX_MCP_URL?.trim(),
    process.env.QLIX_MCP_LEADS_URL?.trim(),
    'http://127.0.0.1:3940/mcp',
    'http://localhost:3940/mcp',
  ].filter((u): u is string => Boolean(u));
  return new Set(candidates.map(normalizeMcpEndpointUrl));
}

/** True for the deployment's own qlix-mcp service — exempt from public-only SSRF checks. */
export function isTrustedQlixMcpUrl(rawUrl: string): boolean {
  return trustedQlixMcpEndpoints().has(normalizeMcpEndpointUrl(rawUrl));
}

/**
 * Throw {@link SsrfBlockedError} unless `rawUrl` is http(s) to a host that resolves only to
 * public addresses. Allows loopback in development (LOCAL MCP/OAuth servers on localhost) when
 * MCP_ALLOW_LOCAL_URLS=1. First-party qlix-mcp URLs are always trusted (same-host deployment).
 */
/**
 * Validate a URL and return the concrete IP addresses it resolves to (all public, unless local is
 * allowed). Callers that actually perform the request should pin the connection to these addresses
 * (see {@link safeFetch}) so a DNS-rebinding attacker cannot swap in a private IP between this check
 * and the socket connect (TOCTOU).
 */
export async function resolveSafeAddresses(rawUrl: string): Promise<string[]> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError('URL must use http or https');
  }
  const allowLocal = process.env.MCP_ALLOW_LOCAL_URLS === '1';
  const host = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (!allowLocal && (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal'))) {
    throw new SsrfBlockedError('URL host is not allowed');
  }
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new SsrfBlockedError(`Cannot resolve host: ${host}`);
    }
  }
  if (addresses.length === 0 || (!allowLocal && addresses.some(isPrivateAddress))) {
    throw new SsrfBlockedError('URL resolves to a non-public address');
  }
  return addresses;
}

export async function assertSafeFetchUrl(rawUrl: string): Promise<void> {
  if (isTrustedQlixMcpUrl(rawUrl)) return;
  await resolveSafeAddresses(rawUrl);
}

const MAX_REDIRECTS = 5;

/**
 * SSRF-safe replacement for `fetch` for operator-supplied URLs. Two protections the bare guard
 * lacks:
 *  1. Redirects are followed manually and every hop is re-validated, so a server cannot 302 to
 *     `http://169.254.169.254/…` or a loopback address after passing the initial check.
 *  2. The connection is pinned (via an undici dispatcher whose `lookup` only yields the addresses
 *     validated above) to the exact IPs we vetted, closing the DNS-rebinding TOCTOU window. TLS SNI
 *     and certificate validation still use the original hostname, so HTTPS is unaffected.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  if (isTrustedQlixMcpUrl(rawUrl)) {
    return fetch(rawUrl, init);
  }
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const addresses = await resolveSafeAddresses(currentUrl);
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          const family = net.isIPv6(addresses[0]) ? 6 : 4;
          if (options && options.all) {
            callback(null, addresses.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 })) as never);
          } else {
            (callback as (err: Error | null, address: string, family: number) => void)(null, addresses[0], family);
          }
        },
      },
    });
    let resp: Response;
    try {
      resp = await fetch(currentUrl, { ...init, redirect: 'manual', dispatcher } as RequestInit);
    } finally {
      void dispatcher.close();
    }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.has('location')) {
      const location = resp.headers.get('location')!;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return resp;
  }
  throw new SsrfBlockedError('Too many redirects');
}
