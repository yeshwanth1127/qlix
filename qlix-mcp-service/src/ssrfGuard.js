import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';

export class SsrfBlockedError extends Error {}

/** True for loopback / private / link-local / ULA / CGNAT addresses we must never fetch. */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

async function resolveSafeAddresses(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError('URL must use http or https');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new SsrfBlockedError('URL host is not allowed');
  }
  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new SsrfBlockedError(`Cannot resolve host: ${host}`);
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new SsrfBlockedError('URL resolves to a non-public address');
  }
  return addresses;
}

const MAX_REDIRECTS = 4;

/**
 * SSRF-safe fetch for scraping arbitrary business websites (URLs come from Google Maps listings).
 * Blocks loopback/private/link-local targets, re-validates every redirect hop, and pins the socket
 * to the validated public IPs so DNS rebinding cannot swap in a private address after the check.
 */
export async function safeFetch(rawUrl, init = {}) {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const addresses = await resolveSafeAddresses(currentUrl);
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          if (options && options.all) {
            callback(null, addresses.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 })));
          } else {
            callback(null, addresses[0], net.isIPv6(addresses[0]) ? 6 : 4);
          }
        },
      },
    });
    let resp;
    try {
      resp = await fetch(currentUrl, { ...init, redirect: 'manual', dispatcher });
    } finally {
      void dispatcher.close();
    }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.has('location')) {
      currentUrl = new URL(resp.headers.get('location'), currentUrl).toString();
      continue;
    }
    return resp;
  }
  throw new SsrfBlockedError('Too many redirects');
}
