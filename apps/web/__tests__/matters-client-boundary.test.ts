// The matters client components never value-import a server-only module (#392). The matter
// loaders (`proceedings-view.ts`, `workspace.ts`, `graph-deps.ts`), the adapter case-type tables
// (`case-types.ts`) and the logger (`src/health.ts`) pull in core, db, adapters and OpenTelemetry,
// whose Node built-ins (`fs`, `async_hooks`, `child_process`) break `next build` for the browser
// bundle. Types are fine (`import type` is erased); the client gets data as props.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../components/matters/', import.meta.url));
const SERVER_ONLY =
  /(lib\/matters\/(proceedings-view|workspace|graph-deps|case-types)\.ts|src\/health\.ts|@causedeck\/(core|db|adapters)(\/[\w-]+)?)'/;

/** Every `import … from '…'` statement of a file, with whether it is type-only. */
function imports(source: string): { statement: string; typeOnly: boolean }[] {
  return [...source.matchAll(/^import\s[\s\S]*?from\s+'[^']+';/gm)].map(([statement]) => ({
    statement,
    typeOnly: /^import\s+type\s/.test(statement),
  }));
}

const clientFiles = readdirSync(DIR)
  .filter((name) => /\.tsx?$/.test(name))
  .filter((name) => /^'use client'/.test(readFileSync(path.join(DIR, name), 'utf8')));

describe('matters client components (#392)', () => {
  it('finds the proceedings tab client components', () => {
    for (const name of ['proceeding-tree.tsx', 'proceeding-row.tsx', 'proceeding-form.tsx']) {
      expect(clientFiles).toContain(name);
    }
  });

  it.each(clientFiles)('%s imports server-only modules as types only', (name) => {
    const source = readFileSync(path.join(DIR, name), 'utf8');
    const offending = imports(source)
      .filter(({ statement, typeOnly }) => SERVER_ONLY.test(statement) && !typeOnly)
      .map(({ statement }) => statement);
    expect(offending).toEqual([]);
  });
});
