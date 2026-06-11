/**
 * SSRF guard for operator-supplied URLs that the backend fetches server-side: MCP endpoints,
 * and OAuth authorization/token/registration/metadata URLs discovered from a server's own
 * metadata. All of these are attacker-influenceable, so none may target internal infrastructure
 * (cloud metadata, loopback, private ranges).
 */
import dns from 'node:dns/promises';
import net from 'node:net';

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

/**
 * Throw {@link SsrfBlockedError} unless `rawUrl` is http(s) to a host that resolves only to
 * public addresses. Allows loopback in development (LOCAL MCP/OAuth servers on localhost) when
 * MCP_ALLOW_LOCAL_URLS=1.
 */
export async function assertSafeFetchUrl(rawUrl: string): Promise<void> {
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
}
