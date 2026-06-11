import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { WebAuthnEnvironment } from '../config/loadEnvironmentConfig.js';
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

/**
 * Express application factory — middleware and API route registration only (no listen).
 */
export function createHttpApplication(input: CreateHttpApplicationInput): Express {
  const application = express();

  application.disable('x-powered-by');
  application.use(helmet());
  application.use(
    cors({
      origin: buildCorsOrigin(input),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-QLIX-Device-Step-Up'],
    }),
  );
  application.use(cookieParser());
  application.use(express.json({ limit: '50mb' }));
  application.use(requestLoggingMiddleware);
  registerApiRoutes(application, { webAuthn: input.webAuthn });

  return application;
}
