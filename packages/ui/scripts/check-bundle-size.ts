// Per-component bundle budget: importing one component must stay small and tree-shakeable.
//
//   pnpm --filter @causedeck/ui check:bundle
//
// Bundles each budgeted subpath export (e.g. `@causedeck/ui/button`) with esbuild, minified, with
// React external (the app already ships it). The budget gates what the component *adds* on top of
// the shared runtime every @causedeck/ui consumer already pays once: `cn` (clsx + tailwind-merge,
// about 8 KB gzip). Absolute sizes are printed too. Also checks the package keeps
// `sideEffects: ["**/*.css"]` so unused components drop out.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';

const packageDir = path.join(import.meta.dirname, '..');

/** gzip budgets in bytes, per subpath export. */
export const BUDGETS: Record<string, number> = {
  './button': 6 * 1024,
  './spinner': 6 * 1024,
  './kbd': 6 * 1024,
  './alert': 6 * 1024,
  './avatar': 6 * 1024,
  './badge': 6 * 1024,
  './card': 6 * 1024,
  './empty-state': 6 * 1024,
  './icon-button': 6 * 1024,
  './progress': 6 * 1024,
  './separator': 6 * 1024,
  './skeleton': 6 * 1024,
  // Library-backed components carry their library: Radix ScrollArea (about 8 KB),
  // react-resizable-panels (about 22 KB), sonner (about 13 KB) and Recharts (about 77 KB).
  './scroll-area': 10 * 1024,
  './resizable': 24 * 1024,
  './sonner': 16 * 1024,
  './chart': 96 * 1024,
};

export const EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

/** Shared runtime every component uses; paid once per app, so not charged to each component. */
export const SHARED_RUNTIME = './src/lib/cn.ts';

export interface BundleSize {
  entry: string;
  /** Minified and gzipped size of the export on its own (plus the shared runtime). */
  bytes: number;
  gzip: number;
  /** gzip bytes the export adds on top of the shared runtime: what the budget gates. */
  added: number;
  budget: number;
}

const sourceFor = (files: string[]): string =>
  files.map((file) => `export * from ${JSON.stringify(path.join(packageDir, file))};`).join('\n');

/** Minified ESM bundle of `files` as an app bundler would include them; returns raw and gzip size. */
export async function bundle(files: string[]): Promise<{ bytes: number; gzip: number }> {
  const result = await build({
    stdin: {
      contents: sourceFor(files),
      resolveDir: packageDir,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: EXTERNAL,
    // CSS imports become a separate stylesheet; the budget is for JavaScript.
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const js = result.outputFiles.find((file) => file.path.endsWith('.js')) ?? result.outputFiles[0];
  if (!js) throw new Error(`esbuild produced no output for ${files.join(', ')}`);
  return { bytes: js.contents.byteLength, gzip: gzipSync(js.contents).byteLength };
}

/** Size of one subpath export and what it adds over the shared runtime. */
export async function measureExport(subpath: string, budget: number): Promise<BundleSize> {
  const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports: Record<string, string>;
  };
  const target = pkg.exports[subpath];
  if (!target) throw new Error(`package.json has no export "${subpath}"`);
  const [shared, withEntry] = await Promise.all([
    bundle([SHARED_RUNTIME]),
    bundle([SHARED_RUNTIME, target]),
  ]);
  return {
    entry: subpath,
    bytes: withEntry.bytes,
    gzip: withEntry.gzip,
    added: Math.max(0, withEntry.gzip - shared.gzip),
    budget,
  };
}

/** Problems with the package's `sideEffects` field; empty when it is exactly `["**\/*.css"]`. */
export function sideEffectsProblems(pkg: { sideEffects?: unknown }): string[] {
  const value = pkg.sideEffects;
  const ok = Array.isArray(value) && value.length === 1 && value[0] === '**/*.css';
  return ok ? [] : [`package.json sideEffects must be ["**/*.css"], got ${JSON.stringify(value)}`];
}

export function overBudget(sizes: BundleSize[]): BundleSize[] {
  return sizes.filter((size) => size.added > size.budget);
}

async function main(): Promise<void> {
  const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    sideEffects?: unknown;
  };
  const problems = sideEffectsProblems(pkg);
  const sizes = await Promise.all(
    Object.entries(BUDGETS).map(([subpath, budget]) => measureExport(subpath, budget)),
  );
  for (const size of sizes) {
    console.log(
      `${`@causedeck/ui${size.entry.slice(1)}`.padEnd(24)} adds ${String(size.added).padStart(5)} B gzip ` +
        `(budget ${String(size.budget)} B; ${String(size.gzip)} B gzip incl. shared cn)`,
    );
  }
  for (const size of overBudget(sizes)) {
    problems.push(
      `${size.entry} adds ${String(size.added)} B gzip, over its ${String(size.budget)} B budget`,
    );
  }
  if (problems.length > 0) {
    console.error(`check:bundle failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
