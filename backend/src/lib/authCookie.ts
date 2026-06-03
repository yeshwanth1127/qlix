import type { Response } from 'express';
import { AUTH_COOKIE_NAME } from './authTokens.js';

export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

function envFlag(name: string, defaultFalse = false): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === '') return defaultFalse;
  return v === '1' || v === 'true' || v === 'yes';
}

export function buildAuthCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'none' | 'strict';
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    secure: envFlag('SESSION_COOKIE_SECURE'),
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SEC * 1000,
    path: '/',
  };
}

export function sendAuthCookie(response: Response, token: string): void {
  response.cookie(AUTH_COOKIE_NAME, token, buildAuthCookieOptions());
}
