// Version and content hash of the demo seed (#93). `DEMO_VERSION` is bumped by hand whenever the
// seeded content changes; it is written to `workspace_settings.demo_version`, so a workspace that
// was restored to an older version is found and reset. The content hash is derived from the rows
// themselves (for a fixed reference day), so a change to the seed without a version bump is caught
// by the test that pins the hash.
import { createHash } from 'node:crypto';

import { demoNewsRows, demoNoticeRows } from './catalogue.ts';
import { demoCorpusRows } from './corpus.ts';
import { demoCourtRows } from './courts.ts';
import { demoMatterRows } from './matters.ts';
import { demoMemory } from './memory.ts';
import { demoModuleRows } from './modules.ts';
import { seedInstant } from './shared.ts';
import { DEMO_WORKSPACES, type DemoWorkspaceKey } from './workspaces.ts';

export const DEMO_VERSION = '2026.10.4';

/** The day the content hash is computed for; the rows of any other day differ only by dates. */
export const DEMO_HASH_DAY = '2026-01-15';

/** A stable JSON form: object keys sorted, dates as ISO strings. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Date) return v.toISOString();
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

/** SHA-256 of the demo workspace's seeded rows (courts, matter graph, modules, memory, corpus, news and notices) for `HASH_DAY`. */
export function demoContentHash(key: DemoWorkspaceKey): string {
  const ws = DEMO_WORKSPACES[key];
  const at = seedInstant(DEMO_HASH_DAY);
  const courts = demoCourtRows(ws, at);
  const graph = demoMatterRows(ws, DEMO_HASH_DAY, at);
  const rows = {
    courts,
    graph,
    modules: demoModuleRows(ws, DEMO_HASH_DAY, at, graph, courts),
    memory: demoMemory(ws, DEMO_HASH_DAY),
    corpus: demoCorpusRows(),
    news: demoNewsRows(DEMO_HASH_DAY),
    notices: demoNoticeRows(DEMO_HASH_DAY),
  };
  return createHash('sha256').update(canonical(rows)).digest('hex');
}
