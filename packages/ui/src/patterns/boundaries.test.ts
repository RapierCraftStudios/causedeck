import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ALLOWED_PACKAGES = new Set([
  'react',
  'radix-ui',
  'vaul',
  'lucide-react',
  'class-variance-authority',
  'clsx',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Module specifiers of static imports and re-exports, side-effect imports and dynamic import(). */
const specifiers = (source: string): string[] =>
  [
    ...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g),
  ].map((m) => m[1] ?? '');

describe('patterns are domain-agnostic', () => {
  const root = import.meta.dirname;
  const files = sourceFiles(root);

  it('finds the pattern sources', () => {
    expect(files.length).toBeGreaterThan(5);
    const chip = readFileSync(path.join(root, 'provenance-chip', 'provenance-chip.tsx'), 'utf8');
    expect(specifiers(chip)).toEqual(
      expect.arrayContaining(['lucide-react', 'react', '../../components/drawer', '../types']),
    );
    expect(specifiers(`import x from '@causedeck/core';`)).toEqual(['@causedeck/core']);
  });

  it.each(files.map((file) => [path.relative(root, file), file]))(
    '%s imports nothing from core, db or apps',
    (_name, file) => {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.')) {
          const target = path.resolve(path.dirname(file), spec);
          // Relative imports stay inside packages/ui/src.
          expect(target.startsWith(path.resolve(root, '..')), spec).toBe(true);
        } else {
          expect(spec, file).not.toMatch(/^@causedeck\//);
          expect(ALLOWED_PACKAGES.has(spec), `${spec} in ${file}`).toBe(true);
        }
      }
    },
  );
});
