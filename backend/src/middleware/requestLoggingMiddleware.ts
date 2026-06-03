import type { NextFunction, Request, Response } from 'express';

/**
 * Logs method, path, status, and duration when the response finishes.
 */
export function requestLoggingMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();
  response.on('finish', () => {
    const logHint = response.locals.logHint as string | undefined;
    if (logHint === 'skip') return;
    const path = request.path;
    // High-frequency runner / UI poll endpoints — omit from access log.
    if (path.endsWith('/ping')) return;
    if (path.includes('/runs/poll')) return;
    if (path.includes('/runtime-status')) return;
    if (path.includes('/runners-status') && response.statusCode === 304) return;
    const durationMs = Date.now() - startedAt;
    console.info(
      `[http] ${request.method} ${request.path} ${String(response.statusCode)} ${String(durationMs)}ms`,
    );
  });
  next();
}
