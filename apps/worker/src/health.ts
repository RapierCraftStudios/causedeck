// `/healthz` and `/readyz` on WORKER_PORT (#13 helpers). Readiness needs a live database through
// pg-boss and every handler subscribed; liveness never touches dependencies.
import { createServer, type Server } from 'node:http';

import { createHealthHandlers, type HealthCheck } from '@causedeck/observability';

export interface HealthServerOptions {
  readonly port: number;
  readonly host?: string;
  readonly checks: Record<string, HealthCheck>;
  readonly timeoutMs?: number;
}

export interface WorkerReadiness {
  isReady(): boolean;
  ping(): Promise<void>;
}

export function workerChecks(worker: WorkerReadiness): Record<string, HealthCheck> {
  return {
    db: () => worker.ping(),
    handlers: () =>
      worker.isReady() ? Promise.resolve() : Promise.reject(new Error('handlers not registered')),
  };
}

/** Start the health server; resolves once it is listening. */
export async function startHealthServer(options: HealthServerOptions): Promise<Server> {
  const handlers = createHealthHandlers({
    checks: options.checks,
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://worker');
    const handler =
      url.pathname === '/healthz'
        ? handlers.healthz
        : url.pathname === '/readyz'
          ? handlers.readyz
          : undefined;
    if (handler === undefined || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
    }
    void handler(new Request(url, { headers })).then(async (response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
