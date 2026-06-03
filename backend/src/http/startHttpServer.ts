import type { Express } from 'express';
import { createServer, type Server } from 'node:http';

export interface StartHttpServerInput {
  port: number;
}

/**
 * Binds the Express app to an HTTP server and begins accepting connections.
 */
export function startHttpServer(application: Express, input: StartHttpServerInput): Server {
  const server = createServer(application);
  server.listen(input.port, () => {
    console.info(`[qlix-backend] listening on http://localhost:${input.port}`);
  });
  return server;
}
