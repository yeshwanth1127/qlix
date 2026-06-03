import cookieParser from 'cookie-parser';
import cors from 'cors';
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

function buildCorsOrigin(input: CreateHttpApplicationInput): string | string[] {
  if (input.nodeEnvironment === 'development') {
    // Dev ergonomics: browsers treat `localhost` and `127.0.0.1` as different origins.
    // If CORS doesn't match, credentialed requests fail and `Set-Cookie` won't be applied,
    // which makes the SPA bounce back to `/sign-in` right after signup.
    const primary = input.frontendUrl;
    const alternates: string[] = [];

    try {
      const url = new URL(primary);
      const host = url.hostname;
      if (host === 'localhost') {
        url.hostname = '127.0.0.1';
        alternates.push(url.toString().replace(/\/$/, ''));
      } else if (host === '127.0.0.1') {
        url.hostname = 'localhost';
        alternates.push(url.toString().replace(/\/$/, ''));
      }
    } catch {
      // If FRONTEND_URL isn't parseable, fall back to the raw string.
    }

    const merged = [primary.replace(/\/$/, ''), ...alternates.map((o) => o.replace(/\/$/, ''))];
    const unique = Array.from(new Set(merged));
    return unique.length === 1 ? unique[0]! : unique;
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
      allowedHeaders: ['Content-Type', 'X-QLIX-Device-Step-Up'],
    }),
  );
  application.use(cookieParser());
  application.use(express.json({ limit: '50mb' }));
  application.use(requestLoggingMiddleware);
  registerApiRoutes(application, { webAuthn: input.webAuthn });

  return application;
}
