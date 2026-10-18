// Source-level guards for apps/web: Node runtime only, typed env only, self-hosted fonts only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const appDir = path.join(import.meta.dirname, '..');
const repoRoot = path.join(appDir, '../..');
const SKIP = new Set(['node_modules', '.next', '__tests__', '.turbo', 'coverage']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx|mjs|js|css|json)$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceFiles(appDir).map((file) => ({
  rel: path.relative(appDir, file),
  text: readFileSync(file, 'utf8'),
}));
const code = files.filter((file) => /\.(?:ts|tsx|mjs|js)$/.test(file.rel));

/**
 * The one sanctioned read outside lib/env.ts: instrumentation.ts must test the literal
 * `process.env.NEXT_RUNTIME` so Next.js can drop the Node-only SDK import from its edge build.
 */
const PROCESS_ENV_ALLOWED: Record<string, RegExp> = {
  'lib/env.ts': /process\.env/,
  'instrumentation.ts': /process\.env\.NEXT_RUNTIME/,
};

describe('apps/web static guards', () => {
  it('scans the app sources', () => {
    expect(code.map((file) => file.rel)).toEqual(
      expect.arrayContaining(['app/layout.tsx', 'proxy.ts', 'lib/env.ts', 'next.config.ts']),
    );
  });

  it("never opts into the edge runtime (no `runtime = 'edge'`)", () => {
    const offenders = code.filter((file) => /runtime\s*[=:]\s*['"]edge['"]/.test(file.text));
    expect(offenders.map((file) => file.rel)).toEqual([]);
  });

  it('reads process.env only in lib/env.ts (plus the NEXT_RUNTIME literal in instrumentation.ts)', () => {
    const offenders = code.flatMap((file) => {
      const reads = file.text.match(/process\.env(?:\.[A-Z_]+)?/g) ?? [];
      const allowed = PROCESS_ENV_ALLOWED[file.rel];
      return reads.filter((read) => !allowed?.test(read)).map((read) => `${file.rel}: ${read}`);
    });
    expect(offenders).toEqual([]);
  });

  it('never references Google Fonts, in the app or in the ui font stylesheet', () => {
    const fontsCss = readFileSync(path.join(repoRoot, 'packages/ui/fonts/fonts.css'), 'utf8');
    const sources = [...files, { rel: 'packages/ui/fonts/fonts.css', text: fontsCss }];
    const offenders = sources.filter((file) =>
      /fonts\.(?:googleapis|gstatic)\.com/.test(file.text),
    );
    expect(offenders.map((file) => file.rel)).toEqual([]);
  });

  it('loads fonts with next/font/local from the ui package, never next/font/google', () => {
    const fonts = readFileSync(path.join(appDir, 'app/fonts.ts'), 'utf8');
    expect(fonts).toContain("from 'next/font/local'");
    expect(code.some((file) => file.text.includes('next/font/google'))).toBe(false);
    for (const [, src] of fonts.matchAll(/'(\.\.\/[^']+\.woff2)'/g)) {
      expect(existsSync(path.join(appDir, 'app', src ?? ''))).toBe(true);
    }
  });

  it("builds standalone output on Next.js's own config", () => {
    const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf8');
    expect(config).toMatch(/output:\s*'standalone'/);
    expect(config).toMatch(/poweredByHeader:\s*false/);
    expect(config).toMatch(/reactStrictMode:\s*true/);
  });

  it('has no API placeholder route (webhooks live in apps/api)', () => {
    expect(existsSync(path.join(appDir, 'app/api'))).toBe(false);
  });

  it('keeps the proxy on Next.js 16 naming (no deprecated middleware.ts)', () => {
    expect(existsSync(path.join(appDir, 'proxy.ts'))).toBe(true);
    expect(existsSync(path.join(appDir, 'middleware.ts'))).toBe(false);
  });
});
