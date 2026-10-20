// `withoutWorkspace` is used only through the audited admin data layer (#309): no apps/admin source
// outside lib/data imports or calls it. The ESLint rule enforces the import; this scan also catches
// a re-export or a dynamic import.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ADMIN_ROOT = path.resolve(import.meta.dirname, '..');
const DATA_LAYER = path.join(ADMIN_ROOT, 'lib', 'data') + path.sep;
const SKIP = new Set(['node_modules', '.next', '.next-e2e', '__tests__']);

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
});
