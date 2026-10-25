// Server components must not import a `@causedeck/ui` module that needs a client component (React
// context or state hooks without `'use client'`, e.g. `@causedeck/ui/table`): `next build` fails on
// it (#311), but vitest renders it happily. `next build` does not run locally, so this scan stands
// in for it: every `.tsx` under app/ and components/ without `'use client'` may import only
// server-safe ui modules.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const adminRoot = fileURLToPath(new URL('..', import.meta.url));
const uiRoot = path.join(adminRoot, '../../packages/ui');
const uiExports = (
  JSON.parse(readFileSync(path.join(uiRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, string>;
  }
).exports;

const CLIENT_DIRECTIVE = /^\s*(?:\/\/[^\n]*\n\s*)*['"]use client['"]/;
const CLIENT_ONLY_API =
  /\b(createContext|useContext|useState|useReducer|useEffect|useLayoutEffect)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** The ui module's own files (its index and the files it re-exports from its folder). */
function uiModuleFiles(subpath: string): string[] {
  const target = uiExports[`./${subpath}`];
  if (target === undefined || !target.endsWith('.ts')) return [];
  const dir = path.dirname(path.join(uiRoot, target));
  return readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|stories)\.tsx?$/.test(f))
    .map((f) => path.join(dir, f));
}

/** True when a module calls a client-only React API in a file without `'use client'`. */
function needsClient(subpath: string): boolean {
  return uiModuleFiles(subpath).some((file) => {
    const text = readFileSync(file, 'utf8');
    return !CLIENT_DIRECTIVE.test(text) && CLIENT_ONLY_API.test(text);
  });
}

const serverComponents = ['app', 'components']
  .flatMap((dir) => sourceFiles(path.join(adminRoot, dir)))
  .filter((file) => !CLIENT_DIRECTIVE.test(readFileSync(file, 'utf8')));

describe('server components import only server-safe ui modules', () => {
  it('flags @causedeck/ui/table as client-only (the scan sees it)', () => {
    expect(needsClient('table')).toBe(true);
    expect(needsClient('button')).toBe(false);
  });

  it.each(serverComponents.map((file) => [path.relative(adminRoot, file), file]))(
    '%s',
    (_name, file) => {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/from '@causedeck\/ui\/([\w/-]+)'/g)].map((m) => m[1]);
      const offending = imports.filter((subpath) => subpath !== undefined && needsClient(subpath));
      expect(offending, 'move the use into a client component').toEqual([]);
    },
  );
});
