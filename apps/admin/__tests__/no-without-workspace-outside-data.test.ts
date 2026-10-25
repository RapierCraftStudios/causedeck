// `withoutWorkspace` is used only through the audited admin data layer (#309): no apps/admin source
// outside lib/data imports or calls it. The ESLint rule enforces the import; this scan also catches
// a re-export or a dynamic import.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ADMIN_ROOT = path.resolve(import.meta.dirname, '..');
const DATA_LAYER = path.join(ADMIN_ROOT, 'lib', 'data') + path.sep;
// eslint.config.js names the identifier to ban it; it is configuration, not a user.
const SKIP = new Set(['node_modules', '.next', '.next-e2e', '__tests__', 'eslint.config.js']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

describe('withoutWorkspace in apps/admin', () => {
  it('appears only under lib/data', () => {
    const users = sources(ADMIN_ROOT).filter((file) =>
      readFileSync(file, 'utf8').includes('withoutWorkspace'),
    );
    expect(users.length).toBeGreaterThan(0);
    expect(
      users.filter((file) => !file.startsWith(DATA_LAYER)).map((f) => path.relative(ADMIN_ROOT, f)),
    ).toEqual([]);
  });

  it('is the only @causedeck/db value the app imports (#299)', () => {
    // `import type` is fine; tests are skipped above (they use @causedeck/db/testing).
    const valueImport = /^import\s+(?!type\b)[^;]*?from\s+'@causedeck\/db(?:\/[^']*)?';/gm;
    const offenders: string[] = [];
    for (const file of sources(ADMIN_ROOT)) {
      for (const [statement] of readFileSync(file, 'utf8').matchAll(valueImport)) {
        const names = /\{([^}]*)\}/.exec(statement)?.[1] ?? '*';
        const values = names
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n !== '' && !n.startsWith('type '));
        const allowed =
          file.startsWith(DATA_LAYER) &&
          statement.endsWith("'@causedeck/db';") &&
          values.every((n) => n === 'withoutWorkspace');
        if (values.length > 0 && !allowed) offenders.push(path.relative(ADMIN_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
