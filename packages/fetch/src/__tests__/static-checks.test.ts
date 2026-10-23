// Static guards for the governed fetch layer (#479, D-048): only packages/fetch imports the
// `alterlab` SDK or reads an external host with `fetch`; the ESLint rules in
// packages/config/eslint/base.js say the same at lint time.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '__fixtures__',
  '__tests__',
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sources(full);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const files = ['apps', 'packages']
  .flatMap((dir) => sources(path.join(root, dir)))
  .filter((file) => !file.startsWith(path.join(root, 'packages', 'fetch') + path.sep))
  .map((file) => ({ file: path.relative(root, file), code: stripComments(readFileSync(file, 'utf8')) }));

describe('external reads', () => {
  it('scans the workspace', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no other package or app imports the alterlab SDK', () => {
    const offenders = files
      .filter(({ code }) => /(?:from|import|require\()\s*['"]alterlab(?:\/[^'"]*)?['"]/.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('no other package or app calls fetch on a literal external host', () => {
    const offenders = files
      .filter(({ code }) => /\bfetch\(\s*[`'"]https?:/.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('packages/fetch itself never reads process.env', () => {
    const own = sources(path.join(root, 'packages', 'fetch', 'src')).map((file) =>
      readFileSync(file, 'utf8'),
    );

    expect(own.filter((code) => /process\.env/.test(code))).toEqual([]);
  });
});
