// The only module in apps/admin that may read `process.env` besides the shared env schema. Typed
// keys come from `@causedeck/config/env`; the runtime flags Next.js itself sets are read here, once.
import { serverEnv, type ServerEnv } from '@causedeck/config/env';

export { isProd, serverEnv } from '@causedeck/config/env';

/** `next dev`: React needs `'unsafe-eval'` in the CSP for its debug stacks. */
export function isDev(): boolean {
  // eslint-disable-next-line no-process-env -- NODE_ENV is set by Next.js, not app configuration.
  return process.env.NODE_ENV === 'development';
}

/** True unless this is a production runtime. Gates the dev staff bypass. */
export function isNonProduction(): boolean {
  // eslint-disable-next-line no-process-env -- NODE_ENV is set by Next.js, not app configuration.
  return process.env.NODE_ENV !== 'production';
}

/** `E2E_BUILD=1 NODE_ENV=development next build`: the e2e harness build (see apps/web). */
export function e2eBuild(): boolean {
  // eslint-disable-next-line no-process-env -- build-time tooling flag, not app configuration.
  return process.env.E2E_BUILD === '1';
}

/** `ADMIN_URL` for next.config (Server Actions `allowedOrigins`), read without the full schema. */
export function buildTimeAdminUrl(): URL | undefined {
  // eslint-disable-next-line no-process-env -- build-time config read; runtime uses adminEnv().
  const raw = process.env.ADMIN_URL;
  if (raw === undefined || raw === '') return undefined;
  return new URL(raw);
}

export class AdminEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminEnvError';
  }
}

export type AdminEnv = ServerEnv & { ADMIN_URL: string };

/** The server env plus the admin keys; `ADMIN_URL` is required in production. */
export function adminEnv(): AdminEnv {
  const env = serverEnv();
  if (env.ADMIN_URL === undefined) {
    if (env.NODE_ENV === 'production') throw new AdminEnvError('ADMIN_URL is required');
    return { ...env, ADMIN_URL: 'http://localhost:3200' };
  }
  return { ...env, ADMIN_URL: env.ADMIN_URL };
}

/** The environment tag in the staff strip. */
export type AdminEnvLabel = 'development' | 'staging' | 'production';

export function adminEnvLabel(env: Pick<ServerEnv, 'NODE_ENV' | 'ADMIN_ENV_LABEL'>): AdminEnvLabel {
  if (env.ADMIN_ENV_LABEL !== undefined) return env.ADMIN_ENV_LABEL;
  return env.NODE_ENV === 'production' ? 'production' : 'development';
}
