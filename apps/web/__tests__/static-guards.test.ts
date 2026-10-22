// Source-level guards for apps/web: Node runtime only, typed env only, self-hosted fonts only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const appDir = path.join(import.meta.dirname, '..');
const repoRoot = path.join(appDir, '../..');
const SKIP = new Set(['node_modules', '.next', '.next-e2e', '__tests__', '.turbo', 'coverage']);

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

  it('imports every token file but not the ui fonts.css, which would download each face twice', () => {
    const globals = readFileSync(path.join(appDir, 'app/globals.css'), 'utf8');
    const imports = [...globals.matchAll(/@import '([^']+)'/g)].map(([, spec]) => spec ?? '');
    expect(imports.filter((spec) => /fonts\.css$|tokens(?:\/index)?\.css$/.test(spec))).toEqual([]);
    const index = readFileSync(path.join(repoRoot, 'packages/ui/tokens/index.css'), 'utf8');
    const tokenFiles = [...index.matchAll(/@import '\.\/([^']+)'/g)].map(([, file]) => file ?? '');
    expect(imports.filter((spec) => spec.startsWith('@causedeck/ui/tokens/'))).toEqual(
      tokenFiles.map((file) => `@causedeck/ui/tokens/${file}`),
    );
  });

  it("builds standalone output on Next.js's own config", () => {
    const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf8');
    expect(config).toMatch(/output:\s*'standalone'/);
    expect(config).toMatch(/poweredByHeader:\s*false/);
    expect(config).toMatch(/reactStrictMode:\s*true/);
  });

  it('loads pdfjs-dist from node_modules, not the server bundle (roster import preview, #459)', () => {
    const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf8');
    expect(config).toMatch(/serverExternalPackages:\s*\[[^\]]*'pdfjs-dist'/);
    const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toHaveProperty('pdfjs-dist');
  });

  it('has no API routes besides Better Auth, Web Push, the audit and workspace exports, uploads, captures and the private calendar feed (webhooks live in apps/api)', () => {
    expect(readdirSync(path.join(appDir, 'app/api')).sort()).toEqual([
      'audit',
      'auth',
      'captures',
      'exports',
      'ics',
      'push',
      'uploads',
    ]);
    // The workspace data export download (#301); tests sit beside it.
    expect(readdirSync(path.join(appDir, 'app/api/exports')).sort()).toEqual(['[id]', '__tests__']);
    expect(readdirSync(path.join(appDir, 'app/api/auth'))).toEqual(['[...all]']);
    // The browser's own push subscription endpoints (#197); tests sit beside them.
    expect(readdirSync(path.join(appDir, 'app/api/push')).sort()).toEqual([
      '__tests__',
      'subscribe',
      'unsubscribe',
    ]);
    // The streamed audit log download (#229), behind a short-lived signed token.
    expect(readdirSync(path.join(appDir, 'app/api/audit')).sort()).toEqual(['__tests__', 'export']);
    // Workspace-scoped upload intents, finalize and download URLs (#217, spike §1).
    expect(readdirSync(path.join(appDir, 'app/api/uploads')).sort()).toEqual([
      '__tests__',
      'route.ts',
    ]);
  });

  it('takes database values from @causedeck/core/runtime, never @causedeck/db (#298)', () => {
    const runtime = code.filter(
      (file) => /^(?:app|lib|src)\//.test(file.rel) && !/\.test\.tsx?$/.test(file.rel),
    );
    expect(runtime.map((file) => file.rel)).toContain('lib/workspace-action.ts');
    const offenders = runtime.flatMap((file) =>
      file.text
        .split('\n')
        .map((line, index) => ({ line, at: `${file.rel}:${String(index + 1)}` }))
        .filter(
          ({ line }) =>
            /import\(\s*'@causedeck\/db'\s*\)/.test(line) ||
            (/from '@causedeck\/db'/.test(line) && !/^\s*import type /.test(line)),
        )
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the proxy on Next.js 16 naming (no deprecated middleware.ts)', () => {
    expect(existsSync(path.join(appDir, 'proxy.ts'))).toBe(true);
    expect(existsSync(path.join(appDir, 'middleware.ts'))).toBe(false);
  });
});
