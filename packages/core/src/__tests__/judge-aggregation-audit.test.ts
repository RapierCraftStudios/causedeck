// No judge aggregation in query code or UI (#389; PX-9, ME-6). `bench.judges` is the court-published
// composition only: nothing may group, count or rank by judge across matters or workspaces, and no
// screen may show per-judge statistics. The database side (schema, migrations, catalog) is checked
// by packages/db/src/__tests__/judge-aggregation-guard.test.ts; this audit reads the TypeScript
// sources of `packages/core` and `packages/db` (Drizzle chains and sql`` templates) and the apps'
// UI sources. A statement (code between semicolons or blank lines, comments removed) that mentions
// judges must not also aggregate, group or rank. The detector is checked on offending samples, so a
// violation really fails the audit.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const JUDGE = /judge/i;
/** Grouping, counting, aggregating or ranking, in Drizzle or SQL. */
const AGGREGATE =
  /\.groupBy\s*\(|\bgroup\s+by\b|\b(count|countDistinct|array_agg|jsonb?_agg|string_agg|unnest|rank|dense_rank|row_number|ntile|percent_rank|cume_dist)\s*\(|\bover\s*\(/i;
/** What a per-judge statistic on screen would say. */
const STATISTIC =
  /\b(count|counts|stat|stats|statistics?|rank|ranking|rate|ratio|percent(age)?|average|tally|leaderboard|analytics|disposal)\b/i;

const SKIPPED_DIRS = new Set(['node_modules', 'migrations', '__tests__', '__fixtures__', 'dist']);

/** Every non-test .ts/.tsx source below `dir`. */
function sources(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return SKIPPED_DIRS.has(name) ? [] : sources(full);
    if (!/\.tsx?$/.test(name) || /\.(test|spec|stories)\.tsx?$/.test(name)) return [];
    return [full];
  });
}

/** The code without comments, cut into statements (semicolons or blank lines). */
function statements(code: string): string[] {
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return bare.split(/;|\n\s*\n/).filter((chunk) => chunk.trim() !== '');
}

/** The statements of `code` that mention judges and match `pattern`. */
function judgeOffences(code: string, pattern: RegExp = AGGREGATE): string[] {
  return statements(code)
    .filter((chunk) => JUDGE.test(chunk) && pattern.test(chunk))
    .map((chunk) => chunk.trim().replace(/\s+/g, ' ').slice(0, 160));
}

function audit(dirs: readonly string[], pattern: RegExp): string[] {
  return dirs
    .flatMap((dir) => sources(path.join(ROOT, dir)))
    .flatMap((file) =>
      judgeOffences(readFileSync(file, 'utf8'), pattern).map(
        (offence) => `${path.relative(ROOT, file)}: ${offence}`,
      ),
    );
}

describe('no judge aggregation in query code or UI (#389; PX-9, ME-6)', () => {
  it('flags grouping, counting and ranking by judge (detector self-check)', () => {
    const offending = [
      'await tx.select({ judges: bench.judges, n: count() }).from(bench).groupBy(bench.judges);',
      'await tx.execute(sql`select judges, count(*) from bench group by judges`);',
      'sql`select rank() over (partition by ${bench.judges} order by n)`;',
      'sql`select unnest(judges) as judge from bench`;',
    ];
    for (const sample of offending) expect(judgeOffences(sample), sample).toHaveLength(1);
    expect(judgeOffences('const n = 3;\n\nconst judges = ["Justice A"];')).toEqual([]);
    expect(judgeOffences('// groups by judge: count(judges)\nconst x = 1;')).toEqual([]);
    expect(judgeOffences('<p>{judge} disposal rate</p>', STATISTIC)).toHaveLength(1);
  });

  it('finds no aggregate over judges in packages/core and packages/db sources', () => {
    const scanned = ['packages/core/src', 'packages/db/src'].flatMap((dir) =>
      sources(path.join(ROOT, dir)),
    );
    expect(scanned.some((file) => file.endsWith(path.join('court', 'rosters.ts')))).toBe(true);
    expect(scanned.some((file) => file.endsWith(path.join('schema', 'roster.ts')))).toBe(true);
    expect(audit(['packages/core/src', 'packages/db/src'], AGGREGATE)).toEqual([]);
  });

  it('shows no per-judge statistics in any app', () => {
    const apps = readdirSync(path.join(ROOT, 'apps')).flatMap((app) => [
      `apps/${app}/app`,
      `apps/${app}/components`,
      `apps/${app}/src`,
    ]);
    expect(apps.length).toBeGreaterThan(0);
    expect(audit(apps, STATISTIC)).toEqual([]);
    expect(audit(apps, AGGREGATE)).toEqual([]);
  });
});
