import 'dotenv/config';

export type NodeEnvironment = 'development' | 'production' | 'test';

export interface WebAuthnEnvironment {
  rpName: string;
  rpId: string;
  /** Origins allowed when verifying WebAuthn responses (must include the SPA origin). */
  expectedOrigins: string[];
}

export interface EnvironmentConfig {
  nodeEnvironment: NodeEnvironment;
  httpPort: number;
  databaseUrl: string;
  /** HS256 secret for session JWT (min 16 chars). */
  jwtSecret: string;
  /** Browser origin for CORS + cookie flows (e.g. http://localhost:3000). */
  frontendUrl: string;
  /** Production: optional extra allowed origins (comma-separated). */
  corsOrigins: string[];
  webAuthn: WebAuthnEnvironment;
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  if (value === 'production' || value === 'test' || value === 'development') {
    return value;
  }
  return 'development';
}

function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '');
}

function hostnameFromUrl(urlString: string): string {
  try {
    return new URL(urlString).hostname;
  } catch {
    return 'localhost';
  }
}

/** Adds the alternate loopback host so WebAuthn works whether the SPA uses localhost or 127.0.0.1. */
function expandLoopbackOrigins(origins: string[]): string[] {
  const out = new Set(origins.map((o) => normalizeOrigin(o)));
  for (const o of [...out]) {
    try {
      const url = new URL(o);
      if (url.hostname === 'localhost') {
        url.hostname = '127.0.0.1';
        out.add(normalizeOrigin(url.toString()));
      } else if (url.hostname === '127.0.0.1') {
        url.hostname = 'localhost';
        out.add(normalizeOrigin(url.toString()));
      }
    } catch {
      // keep as-is
    }
  }
  return Array.from(out);
}

function buildWebAuthnEnvironment(frontendUrl: string): WebAuthnEnvironment {
  const primaryFrontend = normalizeOrigin(frontendUrl);
  const rpName = process.env.WEBAUTHN_RP_NAME?.trim() || 'Qlix';
  const rpId =
    process.env.WEBAUTHN_RP_ID?.trim() || hostnameFromUrl(primaryFrontend || 'http://localhost:3000');

  const fromEnvList = parseCorsOrigins(process.env.WEBAUTHN_ORIGINS);
  const singleOrigin = process.env.WEBAUTHN_ORIGIN?.trim();

  let expectedOrigins: string[];
  if (fromEnvList.length > 0) {
    expectedOrigins = fromEnvList.map((o) => normalizeOrigin(o));
  } else if (singleOrigin) {
    expectedOrigins = [normalizeOrigin(singleOrigin)];
  } else {
    expectedOrigins = [primaryFrontend];
  }

  expectedOrigins = expandLoopbackOrigins(expectedOrigins);

  return { rpName, rpId, expectedOrigins };
}

/**
 * Loads and validates environment variables required by the Qlix API process.
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
  const nodeEnvironment = parseNodeEnvironment(process.env.NODE_ENV);
  const portRaw = process.env.PORT ?? '4000';
  const httpPort = Number.parseInt(portRaw, 10);
  if (Number.isNaN(httpPort) || httpPort < 1) {
    throw new Error(`Invalid PORT: "${portRaw}"`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.trim()) {
    throw new Error('DATABASE_URL is required (see .env.example)');
  }

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret || jwtSecret.length < 16) {
    throw new Error('JWT_SECRET is required and must be at least 16 characters (see .env.example)');
  }

  const frontendUrl = process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';

  const platformDid = process.env.QLIX_PLATFORM_DID?.trim();
  const platformPrivateKey = process.env.QLIX_PLATFORM_PRIVATE_KEY?.trim();
  if (!platformDid || !platformPrivateKey) {
    throw new Error(
      'QLIX_PLATFORM_DID and QLIX_PLATFORM_PRIVATE_KEY are required (see .env.example)',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(platformPrivateKey)) {
    throw new Error(
      'QLIX_PLATFORM_PRIVATE_KEY must be exactly 64 hex characters (Ed25519 seed / 32 bytes)',
    );
  }

  const webAuthn = buildWebAuthnEnvironment(frontendUrl);

  return {
    nodeEnvironment,
    httpPort,
    databaseUrl: databaseUrl.trim(),
    jwtSecret,
    frontendUrl,
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
    webAuthn,
  };
}
