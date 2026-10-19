// API process entry (#14, spike §1): env, telemetry, Better Auth, `createApp`, @hono/node-server.
// On SIGTERM the server stops accepting connections, lets in-flight requests finish for up to
// 10 s, then closes whatever is left, releases the database pool and exits 0.
import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import { createMailer } from '@causedeck/auth/mailer';
import { createAuth } from '@causedeck/auth/server';
import { serverEnv } from '@causedeck/config/env';
import { closeDb, db } from '@causedeck/db';
import {
  createLogger,
  initTelemetry,
  type HealthCheck,
  type Logger,
} from '@causedeck/observability';
import { createObjectStoreFromEnv, storageReadyCheck, type StorageEnv } from '@causedeck/storage';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';

import { createApp } from './app.ts';

export const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface StartServerOptions {
  app: Pick<Hono, 'fetch'>;
  port: number;
  hostname?: string;
}

/** Listen on `port` (0 picks a free one); resolves with the bound port. */
export function startServer({
  app,
  port,
  hostname = '0.0.0.0',
}: StartServerOptions): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      server.off('error', reject);
      resolve({ server: server as Server, port: info.port });
    });
    server.once('error', reject);
  });
}

/**
 * Stop accepting connections and wait for in-flight requests, at most `timeoutMs`; then force
 * the remaining connections closed. Resolves `'drained'` or `'timeout'`.
 */
export function drainServer(
  server: Server,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
): Promise<'drained' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
      resolve('timeout');
    }, timeoutMs);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolve('drained');
    });
    // Keep-alive sockets with no request in flight would otherwise hold `close()` open.
    server.closeIdleConnections();
  });
}

export interface ShutdownOptions {
  logger: Pick<Logger, 'info' | 'error'>;
  /** Extra cleanup after the server has drained (db pool, telemetry). */
  cleanup?: () => Promise<void>;
  timeoutMs?: number;
  exit?: (code: number) => void;
  signals?: readonly NodeJS.Signals[];
}

/** Install SIGTERM/SIGINT handlers that drain `server` once and exit 0. */
export function handleShutdownSignals(server: Server, options: ShutdownOptions): () => void {
  const {
    logger,
    cleanup,
    timeoutMs = SHUTDOWN_TIMEOUT_MS,
    exit = (code) => process.exit(code),
    signals = ['SIGTERM', 'SIGINT'],
  } = options;
  let stopping = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal, timeoutMs }, 'shutting down: draining in-flight requests');
    void (async () => {
      try {
        const outcome = await drainServer(server, timeoutMs);
        logger.info({ outcome }, 'server closed');
        await cleanup?.();
      } catch (error) {
        logger.error({ err: error }, 'error during shutdown');
      }
      exit(0);
    })();
  };
  for (const signal of signals) process.on(signal, onSignal);
  return () => {
    for (const signal of signals) process.off(signal, onSignal);
  };
}

/** Readiness checks beyond `db`: `storage` heads the configured bucket (#21). */
export function readyChecksFromEnv(env: StorageEnv): Record<string, HealthCheck> {
  return { storage: storageReadyCheck(createObjectStoreFromEnv(env)) };
}

async function main(): Promise<void> {
  const env = serverEnv();
  const telemetry = initTelemetry({ service: 'api' });
  const logger = createLogger({ service: 'api' });
  const auth = createAuth({ db, env, mailer: createMailer(env, logger), logger });

  const app = createApp({
    db,
    auth,
    logger,
    allowedOrigins: [env.APP_URL],
    readyChecks: readyChecksFromEnv(env),
  });
  const { server, port } = await startServer({ app, port: env.API_PORT });
  handleShutdownSignals(server, {
    logger,
    cleanup: async () => {
      await closeDb();
      await telemetry.shutdown();
    },
  });
  logger.info({ port }, 'api ready');
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
