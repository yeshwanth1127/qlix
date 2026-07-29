import type { Express } from 'express';
import { createServer, type Server } from 'node:http';
import { prisma } from '../lib/prisma.js';

export interface StartHttpServerInput {
  port: number;
}

/** Force-exit ceiling if in-flight requests (e.g. long streaming chat responses) never drain. */
const SHUTDOWN_FORCE_EXIT_MS = 10_000;

/**
 * Binds the Express app to an HTTP server and begins accepting connections.
 * Also wires SIGTERM/SIGINT so a PM2 restart/deploy stops accepting new
 * connections, lets in-flight requests finish, closes the Prisma pool, and
 * only then exits — instead of hard-killing everything mid-request.
 */
export function startHttpServer(application: Express, input: StartHttpServerInput): Server {
  const server = createServer(application);
  server.listen(input.port, () => {
    console.info(`[qlix-backend] listening on http://localhost:${input.port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[qlix-backend] ${signal} received — draining in-flight requests`);

    const forceExit = setTimeout(() => {
      console.warn(`[qlix-backend] shutdown drain exceeded ${SHUTDOWN_FORCE_EXIT_MS}ms — forcing exit`);
      process.exit(1);
    }, SHUTDOWN_FORCE_EXIT_MS);
    forceExit.unref();

    server.close(async () => {
      try {
        await prisma.$disconnect();
      } catch (err) {
        console.error('[qlix-backend] prisma disconnect error during shutdown', err);
      } finally {
        clearTimeout(forceExit);
        console.info('[qlix-backend] shutdown complete');
        process.exit(0);
      }
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}
