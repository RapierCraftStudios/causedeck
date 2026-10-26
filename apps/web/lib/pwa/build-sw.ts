// Builds `app/sw.ts` into `public/sw.js` (#50) with esbuild, called from next.config.ts when the dev
// server or `next build` starts. The worker is a plain bundle served from the site root, so its
// scope is `/` and never needs `Service-Worker-Allowed`. `@serwist/next` and the Turbopack route
// both serve it from a sub-path, which does (ADR 0026). Only the offline pages (`/offline` and the court-day shell, #65) and the icons are
// precached with a per-build revision; hashed `/_next/static/*` assets cache on first use.
import { buildSync } from 'esbuild';
import path from 'node:path';

const PRECACHED = ['/offline', '/offline/court-day'] as const;

export function buildServiceWorker(appDir: string, { minify }: { minify: boolean }): void {
  const revision = Date.now().toString(36);
  buildSync({
    entryPoints: [path.join(appDir, 'app/sw.ts')],
    outfile: path.join(appDir, 'public/sw.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify,
    logLevel: 'warning',
    define: {
      __SW_MANIFEST__: JSON.stringify(PRECACHED.map((url) => ({ url, revision }))),
    },
  });
}
