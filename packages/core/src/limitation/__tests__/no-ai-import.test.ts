// A limitation date is never computed by a model (#940): no file of this domain imports
// `@causedeck/ai` or reaches into `packages/ai`.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = path.join(import.meta.dirname, '..');

describe('limitation domain', () => {
  it('imports nothing from packages/ai', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
    expect(files).toContain('engine.ts');
    for (const file of files) {
      const source = readFileSync(path.join(DIR, file), 'utf8');
      const specifiers = [...source.matchAll(/\b(?:from|import)\s*\(?\s*'([^']+)'/g)].map(
        (m) => m[1],
      );
      for (const specifier of specifiers) {
        expect(specifier, file).not.toMatch(/^@causedeck\/ai|packages\/ai|\/ai\/index/);
      }
    }
  });
});
