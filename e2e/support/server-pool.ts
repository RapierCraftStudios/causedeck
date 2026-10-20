// The e2e web servers (#16). `apps/web` is built once with `E2E_BUILD=1 NODE_ENV=development`
// (a compiled build that keeps the dev sign-in provider; see apps/web/next.config.ts) into
// `.next-e2e`. Two kinds of server run from that build:
//   - the Playwright `webServer` on E2E_PORT (3100): `node support/server-pool.ts serve` checks the
//     Docker stack, builds, then serves against the template database so global setup can warm
//     the per-role sessions before the template is sealed;
//   - one server per Playwright worker on E2E_PORT + 1 + parallelIndex, each pointed at its own
//     clone of the template (`DATABASE_URL` per worker), started by the worker fixture.
// The admin console (apps/admin, #309) is built the same way into apps/admin/.next-e2e by the
// `webServer` step; admin specs start one admin server per worker on E2E_ADMIN_PORT + 1 + index,
// against that worker's database (fixtures/admin.ts).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertStackUp, databaseUrl, E2E_AUTH_SECRET, TEMPLATE_DB } from './db-reset.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const webDir = path.join(repoRoot, 'apps/web');
const nextBin = path.join(webDir, 'node_modules/next/dist/bin/next');
const adminDir = path.join(repoRoot, 'apps/admin');
const adminNextBin = path.join(adminDir, 'node_modules/next/dist/bin/next');

/* eslint-disable no-process-env -- the harness is configured by its own env vars, read here. */
export const BASE_PORT = Number(process.env.E2E_PORT ?? 3100);
/** Admin servers listen on E2E_ADMIN_PORT + 1 + parallelIndex (default 3300 + 1 + index). */
export const ADMIN_BASE_PORT = Number(process.env.E2E_ADMIN_PORT ?? BASE_PORT + 200);
/** The dev stack's Mailpit (infra/docker/compose.dev.yml): SMTP in, HTTP API out. */
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const SMTP_URL = process.env.E2E_SMTP_URL ?? 'smtp://127.0.0.1:1025';
const inheritedEnv = process.env;
/* eslint-enable no-process-env */

/**
 * An e2e-only VAPID pair so Web Push is enabled (#197); no push ever leaves the machine. Generated
 * at runtime (#271), never committed: the first process to load this module (the Playwright
 * runner) writes it to its env, so the `webServer`, the build and every worker server inherit the
 * same pair.
 */
function e2eVapid(): { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string } {
  const { E2E_VAPID_PUBLIC_KEY, E2E_VAPID_PRIVATE_KEY } = inheritedEnv;
  if (E2E_VAPID_PUBLIC_KEY && E2E_VAPID_PRIVATE_KEY) {
    return { VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: E2E_VAPID_PRIVATE_KEY };
  }
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  // The uncompressed P-256 point (0x04 || x || y), URL-safe base64, as `web-push` expects.
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? '', 'base64url'),
    Buffer.from(jwk.y ?? '', 'base64url'),
  ]);
  const pair = {
    VAPID_PUBLIC_KEY: point.toString('base64url'),
    VAPID_PRIVATE_KEY: privateKey.export({ format: 'jwk' }).d ?? '',
  };
  inheritedEnv.E2E_VAPID_PUBLIC_KEY = pair.VAPID_PUBLIC_KEY;
  inheritedEnv.E2E_VAPID_PRIVATE_KEY = pair.VAPID_PRIVATE_KEY;
  return pair;
}
const E2E_VAPID = e2eVapid();

export function workerPort(parallelIndex: number): number {
  return BASE_PORT + 1 + parallelIndex;
}

export function adminWorkerPort(parallelIndex: number): number {
  return ADMIN_BASE_PORT + 1 + parallelIndex;
}

/**
 * The admin servers' IP allowlist (#309). The admin fixtures send `X-Forwarded-For` from inside
 * it, so a test probes the allowlist by sending an address outside it.
 */
export const ADMIN_E2E_ALLOWLIST = '203.0.113.0/24';
export const ADMIN_E2E_ALLOWED_IP = '203.0.113.10';

export function originFor(port: number): string {
  return `http://localhost:${String(port)}`;
}

/**
 * Environment of an e2e web server: local-only providers, no credentials, no network. The
 * `webServer` uses the console mailer; worker servers send to Mailpit, because the console
 * mailer's log line has the magic-link token redacted and tests need the real link.
 */
export function serverEnv(
  port: number,
  dbUrl: string,
  mail: 'console' | 'mailpit' = 'console',
): NodeJS.ProcessEnv {
  return {
    ...inheritedEnv,
    NODE_ENV: 'development',
    E2E_BUILD: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(port),
    APP_URL: originFor(port),
    NEXT_PUBLIC_APP_URL: originFor(port),
    DATABASE_URL: dbUrl,
    BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
    ...E2E_VAPID,
    ...(mail === 'mailpit' ? { EMAIL_PROVIDER: 'smtp', SMTP_URL } : { EMAIL_PROVIDER: 'console' }),
    AI_PROVIDER: 'mock',
    AUTH_GOOGLE_ENABLED: 'false',
    SENTRY_ENABLED: 'false',
    LOG_LEVEL: 'info',
  };
}

/** `next build` of apps/web into `.next-e2e`. Skipped when `E2E_SKIP_BUILD=1` (local reruns). */
export function buildApp(): void {
  if (inheritedEnv.E2E_SKIP_BUILD === '1') return;
  const result = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: webDir,
    stdio: 'inherit',
    env: serverEnv(BASE_PORT, databaseUrl(TEMPLATE_DB, 'app')),
  });
  if (result.status !== 0) throw new Error(`e2e: next build failed (${String(result.status)})`);
}

/** Environment of an e2e admin server: the web server's, on the admin origin, with the allowlist. */
export function adminServerEnv(port: number, dbUrl: string): NodeJS.ProcessEnv {
  return {
    ...serverEnv(port, dbUrl, 'mailpit'),
    ADMIN_URL: originFor(port),
    ADMIN_IP_ALLOWLIST: ADMIN_E2E_ALLOWLIST,
    ADMIN_ENV_LABEL: 'development',
    // The flags page shows this flag as forced off by its kill switch (#311, flags.spec.ts).
    KILL_INSIGHTS_ENABLED: '1',
  };
}

/** `next build` of apps/admin into `.next-e2e` (#309). Skipped with `E2E_SKIP_BUILD=1`. */
export function buildAdminApp(): void {
  if (inheritedEnv.E2E_SKIP_BUILD === '1') return;
  const result = spawnSync(process.execPath, [adminNextBin, 'build'], {
    cwd: adminDir,
    stdio: 'inherit',
    env: adminServerEnv(ADMIN_BASE_PORT, databaseUrl(TEMPLATE_DB, 'app')),
  });
  if (result.status !== 0) {
    throw new Error(`e2e: admin next build failed (${String(result.status)})`);
  }
}

export interface RunningServer {
  url: string;
  /** Everything the server printed so far (stdout and stderr). */
  logs: () => string;
  stop: () => Promise<void>;
}

async function waitForHealthy(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`e2e: web server exited with ${String(child.exitCode)}`);
    }
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`e2e: web server at ${url} was not healthy within ${String(timeoutMs)} ms`);
}

/** `next start` from the e2e build on `port`, against `dbUrl`. */
export function startServer(port: number, dbUrl: string): Promise<RunningServer> {
  return startNext(webDir, nextBin, port, serverEnv(port, dbUrl, 'mailpit'));
}

/** `next start` of the apps/admin e2e build on `port`, against `dbUrl` (#309). */
export function startAdminServer(port: number, dbUrl: string): Promise<RunningServer> {
  return startNext(adminDir, adminNextBin, port, adminServerEnv(port, dbUrl));
}

async function startNext(
  cwd: string,
  bin: string,
  port: number,
  env: NodeJS.ProcessEnv,
): Promise<RunningServer> {
  const child = spawn(process.execPath, [bin, 'start', '-p', String(port)], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = (chunk: Buffer) => {
    output += chunk.toString('utf8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const url = originFor(port);
  try {
    await waitForHealthy(url, child, 60_000);
  } catch (error) {
    child.kill('SIGKILL');
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`);
  }
  return {
    url,
    logs: () => output,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => {
          resolve();
        });
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref();
      }),
  };
}

/** Playwright `webServer` entry: stack check, build, then serve on E2E_PORT until killed. */
async function serve(): Promise<void> {
  await assertStackUp(MAILPIT_URL);
  buildApp();
  buildAdminApp();
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(BASE_PORT)], {
    cwd: webDir,
    env: serverEnv(BASE_PORT, databaseUrl(TEMPLATE_DB, 'app')),
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code) => process.exit(code ?? 0));
}

if (process.argv[2] === 'serve' && process.argv[1] === fileURLToPath(import.meta.url)) {
  serve().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
