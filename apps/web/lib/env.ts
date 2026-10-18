// The only module in apps/web that may read `process.env` (lint rule from #4). Typed keys come from
// `@causedeck/config/env`; the few runtime flags Next.js itself sets are read here, once.
// One exception: instrumentation.ts keeps its literal `process.env.NEXT_RUNTIME` check, because
// Next.js only drops the Node-only SDK import from the edge build when it sees that literal.
export { isCI, isProd, serverEnv } from '@causedeck/config/env';
export { clientEnv } from '@causedeck/config/env/client';

/** `next dev`: React needs `'unsafe-eval'` in the CSP for its debug stacks. */
export function isDev(): boolean {
  // eslint-disable-next-line no-process-env -- NODE_ENV is set by Next.js, not app configuration.
  return process.env.NODE_ENV === 'development';
}

/** `ANALYZE=true next build` turns on @next/bundle-analyzer (see `pnpm analyze`). */
export function analyzeBundle(): boolean {
  // eslint-disable-next-line no-process-env -- build-time tooling flag, not app configuration.
  return process.env.ANALYZE === 'true';
}

/**
 * `APP_URL` for next.config (Server Actions `allowedOrigins`). Read without validating the whole
 * server env, because `next build` must not need runtime secrets; runtime code uses `serverEnv()`.
 */
export function buildTimeAppUrl(): URL | undefined {
  // eslint-disable-next-line no-process-env -- build-time config read; see the note above.
  const raw = process.env.APP_URL;
  if (raw === undefined || raw === '') return undefined;
  return new URL(raw);
}
