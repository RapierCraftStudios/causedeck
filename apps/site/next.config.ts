import path from 'node:path';

import type { NextConfig } from 'next';

const repoRoot = path.join(import.meta.dirname, '../..');

// Static export only (spike §1, §3.3): no server runtime, no middleware, no rewrites or headers().
// Response headers and redirects live in public/_headers and public/_redirects (Cloudflare Pages).
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // Workspace packages ship TypeScript source, so Next.js compiles them.
  transpilePackages: ['@causedeck/ui', '@causedeck/config'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
