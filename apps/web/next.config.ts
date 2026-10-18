import path from 'node:path';

import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { analyzeBundle, buildTimeAppUrl } from './lib/env.ts';

const repoRoot = path.join(import.meta.dirname, '../..');

/** Every workspace package ships TypeScript source, so Next.js compiles them. */
const workspacePackages = [
  '@causedeck/adapters',
  '@causedeck/ai',
  '@causedeck/auth',
  '@causedeck/billing',
  '@causedeck/capture',
  '@causedeck/config',
  '@causedeck/core',
  '@causedeck/db',
  '@causedeck/drafting',
  '@causedeck/flags',
  '@causedeck/i18n',
  '@causedeck/intelligence',
  '@causedeck/notifications',
  '@causedeck/observability',
  '@causedeck/storage',
  '@causedeck/ui',
  '@causedeck/validators',
];

const appUrl = buildTimeAppUrl();

// Baseline headers for every response. The nonce CSP is per request (proxy.ts); Caddy adds HSTS.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  transpilePackages: workspacePackages,
  // Stable in Next.js 16 (it was `experimental.typedRoutes` before).
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
    // CSRF: Server Actions only accept requests whose Origin matches the app (spike §3).
    serverActions: { allowedOrigins: appUrl ? [appUrl.host] : [] },
  },
  headers: () => Promise.resolve([{ source: '/:path*', headers: securityHeaders }]),
};

const withNextIntl = createNextIntlPlugin({
  requestConfig: './i18n/request.ts',
  experimental: {
    // ICU messages compile at build time, which keeps the ICU parser out of the client bundle.
    messages: { format: 'json', path: './messages', locales: 'infer', precompile: true },
  },
});
const withBundleAnalyzer = bundleAnalyzer({ enabled: analyzeBundle() });

export default withBundleAnalyzer(withNextIntl(nextConfig));
