// Next.js config for the staff admin console (#309): standalone output for infra/docker/
// admin.Dockerfile, Node runtime, and the admin security headers on every response (the nonce CSP
// is per request, in proxy.ts). English only, so no next-intl plugin.
import path from 'node:path';

import type { NextConfig } from 'next';

import { ADMIN_SECURITY_HEADERS } from './lib/csp.ts';
import { buildTimeAdminUrl, e2eBuild } from './lib/env.ts';

const repoRoot = path.join(import.meta.dirname, '../..');

/** Workspace packages ship TypeScript source, so Next.js compiles them. */
const workspacePackages = [
  '@causedeck/auth',
  '@causedeck/config',
  '@causedeck/core',
  '@causedeck/db',
  '@causedeck/flags',
  '@causedeck/observability',
  '@causedeck/ui',
];

const adminUrl = buildTimeAdminUrl();

const nextConfig: NextConfig = {
  output: 'standalone',
  // The e2e build gets its own output folder so it never overwrites a production build.
  ...(e2eBuild() ? { distDir: '.next-e2e' } : {}),
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  transpilePackages: workspacePackages,
  typedRoutes: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // Node-only observability SDKs load from node_modules at runtime instead of being bundled.
  serverExternalPackages: [
    'pino',
    'pino-pretty',
    '@sentry/node',
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
  ],
  images: { remotePatterns: [] },
  experimental: {
    // CSRF: Server Actions only accept requests whose Origin matches the admin console.
    serverActions: { allowedOrigins: adminUrl ? [adminUrl.host] : [] },
    ...(e2eBuild() ? { allowDevelopmentBuild: true as const } : {}),
  },
  headers: () => Promise.resolve([{ source: '/:path*', headers: [...ADMIN_SECURITY_HEADERS] }]),
};

export default nextConfig;
