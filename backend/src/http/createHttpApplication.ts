import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { WebAuthnEnvironment } from '../config/loadEnvironmentConfig.js';
import { ensureGatewayAdapters } from '../gateway/index.js';
import { API_KEY_PREFIX } from '../lib/apiKeyScopes.js';
import { apiKeyRateLimitBucket } from '../lib/apiKeyAudit.js';
import { requestLoggingMiddleware } from '../middleware/requestLoggingMiddleware.js';
import { registerApiRoutes } from './registerApiRoutes.js';

export interface CreateHttpApplicationInput {
  nodeEnvironment: string;
  corsOrigins: string[];
  /** Primary SPA origin (cookies + CORS). */
  frontendUrl: string;
  webAuthn: WebAuthnEnvironment;
}

function buildCorsOrigin(input: CreateHttpApplicationInput): CorsOptions['origin'] {
  if (input.nodeEnvironment === 'development') {
    // Dev ergonomics: allow any loopback origin regardless of port. The SPA, the
    // Flutter web client (which picks a random port each launch), and native
    // clients (no Origin header) all need to talk to the API. Browsers also treat
    // `localhost` and `127.0.0.1` as different origins, so match both.
    return (origin, callback) => {
      // No Origin header → non-browser client (Flutter native, curl). Always allow.
      if (!origin) {
        callback(null, true);
        return;
      }
      let isLoopback = false;
      try {
        const host = new URL(origin).hostname;
        isLoopback = host === 'localhost' || host === '127.0.0.1';
      } catch {
        isLoopback = false;
      }
      callback(isLoopback ? null : new Error(`Origin not allowed by CORS: ${origin}`), isLoopback);
    };
  }
  if (input.corsOrigins.length > 0) {
    return input.corsOrigins;
  }
  return input.frontendUrl;
}

function isHybridRunnerHeartbeat(request: Request): boolean {
  // Ping + long-poll are high-frequency, authenticated with X-QLIX-Runner-Token.
  // Hundreds of agents often share one NAT IP — a global per-IP bucket wrongly 429s them.
  const path = request.path || request.url || '';
  return /\/agents\/[^/]+\/(ping|runs\/poll)\/?$/.test(path);
}

/**
 * Baseline abuse/DoS guard applied to every route. Previously only 3 of 32 routers had any
 * rate limiting at all (auth, waitlist, homepage-visits) — everything else, including the
 * JIT poll endpoint and the public sandbox download proxy, had none. This doesn't replace
 * those tighter, endpoint-specific limiters (still layered on top); it's the floor everyone
 * else gets. Requests carrying a valid internal-service secret (the WhatsApp/MCP sidecars,
 * agent runners' own auth is separate) skip it — trusted machine-to-machine traffic that
 * can legitimately be chattier than a browser.
 */
function extractRawApiKeyForRateLimit(request: Request): string | undefined {
  const header = request.headers['x-api-key'];
  const fromHeader = typeof header === 'string' ? header.trim() : Array.isArray(header) ? header[0]?.trim() : undefined;
  if (fromHeader?.startsWith(API_KEY_PREFIX)) return fromHeader;
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    const token = match?.[1]?.trim();
    if (token?.startsWith(API_KEY_PREFIX)) return token;
  }
  return undefined;
}

function globalApiRateLimiter() {
  const limit = Number(process.env.GLOBAL_RATE_LIMIT_PER_MINUTE) || 600;
  const apiKeyLimit = Number(process.env.API_KEY_RATE_LIMIT_PER_MINUTE) || 300;
  return rateLimit({
    windowMs: 60_000,
    limit: (request) => (extractRawApiKeyForRateLimit(request) ? apiKeyLimit : limit),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (request) => {
      const rawKey = extractRawApiKeyForRateLimit(request);
      if (rawKey) return apiKeyRateLimitBucket(rawKey);
      const ip = request.ip || request.socket.remoteAddress || 'unknown';
      return ipKeyGenerator(ip);
    },
    skip: (request) => {
      if (process.env.GLOBAL_RATE_LIMIT_DISABLED === '1') return true;
      if (isHybridRunnerHeartbeat(request)) return true;
      const expected = process.env.QLIX_INTERNAL_SERVICE_SECRET?.trim();
      const provided = request.header('x-service-secret')?.trim();
      return Boolean(expected && provided && provided === expected);
    },
    message: { error: { code: 'rate_limited', message: 'Too many requests. Please slow down and try again shortly.' } },
  });
}

/**
 * Express application factory — middleware and API route registration only (no listen).
 */
export function createHttpApplication(input: CreateHttpApplicationInput): Express {
  const application = express();

  application.disable('x-powered-by');
  // Exactly one reverse proxy (nginx, same host) sits in front — trust its X-Forwarded-For
  // hop so rate limiting and req.ip see the real client IP instead of nginx's own address.
  // Required as soon as any rate limiter is added; `true` would trust the whole XFF chain
  // (client-spoofable), so pin the hop count instead.
  application.set('trust proxy', 1);
  application.use(helmet());
  application.use(
    cors({
      origin: buildCorsOrigin(input),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-QLIX-Device-Step-Up'],
    }),
  );
  application.use(cookieParser());
  // Bound the per-request body to limit memory-exhaustion DoS. Default 15mb (down from 50mb) still
  // covers the largest legitimate JSON payloads (base64 file upload for WhatsApp, inference requests
  // carrying base64 screenshots); raw report-PDF uploads use their own 60mb `raw()` parser.
  application.use(express.json({ limit: process.env.JSON_BODY_LIMIT?.trim() || '15mb' }));
  application.use(requestLoggingMiddleware);
  application.use(globalApiRateLimiter());
  ensureGatewayAdapters();
  registerApiRoutes(application, { webAuthn: input.webAuthn });

  // Central error handler: log full detail server-side, never leak stack traces / internals to
  // clients. Must be registered last and keep the 4-arg signature so Express treats it as an
  // error handler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  application.use((err: unknown, _req: Request, response: Response, _next: NextFunction) => {
    console.error('[unhandled]', err);
    if (response.headersSent) return;
    response.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  });

  return application;
}
