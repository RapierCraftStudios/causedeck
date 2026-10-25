// Matter-graph fixtures (#349, part 6 of #32): `buildChennaiSoloGraph()` builds a W.P. with two
// W.M.P. children, an SR-stage proceeding and a W.P. -> W.A. appeal link, with fictional people
// only: every name it writes, and every name literal in the fixtures source, is a FICTIONAL_NAMES
// entry.
import { readFileSync } from 'node:fs';

import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { bench } from '../schema/court.ts';
import { listing } from '../schema/docket.ts';
import { person } from '../schema/people.ts';
import { proceeding, proceedingLink } from '../schema/proceedings.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import {
  buildChennaiSoloGraph,
  FICTIONAL_NAME_LIST,
  FICTIONAL_NAMES,
} from '../testing/matter-graph-fixtures.ts';
import { newWorkspace } from './rls/fixtures.ts';

const FIXTURES_SOURCE = new URL('../testing/matter-graph-fixtures.ts', import.meta.url);

describe('buildChennaiSoloGraph', () => {
  it('builds a W.P. with two W.M.P.s, an SR-stage W.P. and a W.A. appeal link', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await inWorkspace(tx, ws.id, async (s) => {
        const graph = await buildChennaiSoloGraph(s, ws.id);
        const rows = await s
          .select()
          .from(proceeding)
          .where(eq(proceeding.matterId, graph.matterId));
        expect(rows).toHaveLength(5);

        const wp = rows.find((r) => r.id === graph.writPetitionId);
        expect(wp).toMatchObject({
          kind: 'main',
          caseTypeCode: 'WP',
          number: '10234',
          year: 2026,
          state: 'numbered',
        });

        const misc = rows.filter((r) => r.caseTypeCode === 'WMP');
        expect(misc.map((r) => r.id).sort()).toEqual([...graph.miscPetitionIds].sort());
        for (const wmp of misc) {
          expect(wmp).toMatchObject({ kind: 'misc', parentProceedingId: graph.writPetitionId });
        }
        const parentLinks = await s
          .select({ to: proceedingLink.toProceedingId })
          .from(proceedingLink)
          .where(
            and(
              eq(proceedingLink.fromProceedingId, graph.writPetitionId),
              eq(proceedingLink.kind, 'parent_of'),
            ),
          );
        expect(parentLinks.map((l) => l.to).sort()).toEqual([...graph.miscPetitionIds].sort());

        const sr = rows.filter((r) => r.state === 'sr_fr');
        expect(sr).toHaveLength(1);
        expect(sr[0]).toMatchObject({ id: graph.srStageId, number: null, year: null });
        expect(sr[0]?.srNo).not.toBeNull();

        expect(rows.find((r) => r.id === graph.writAppealId)).toMatchObject({
          kind: 'appeal',
          caseTypeCode: 'WA',
        });
        const appeal = await s
          .select({ from: proceedingLink.fromProceedingId, to: proceedingLink.toProceedingId })
          .from(proceedingLink)
          .where(eq(proceedingLink.kind, 'appeal_from'));
        expect(appeal).toEqual([{ from: graph.writAppealId, to: graph.writPetitionId }]);

        const [canonical] = await s
          .select({ id: listing.id })
          .from(listing)
          .where(and(eq(listing.proceedingId, graph.writPetitionId), eq(listing.canonical, true)));
        expect(canonical?.id).toBe(graph.listingId);
      });
    });
  });

  it('writes fictional names only', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await inWorkspace(tx, ws.id, async (s) => {
        const graph = await buildChennaiSoloGraph(s, ws.id);
        const people = await s
          .select({ name: person.name, aliases: person.aliases })
          .from(person)
          .where(inArray(person.id, Object.values(graph.personIds)));
        const titles = await s
          .select({ p: proceeding.titlePetitioner, r: proceeding.titleRespondent })
          .from(proceeding)
          .where(eq(proceeding.matterId, graph.matterId));
        const [b] = await s
          .select({ judges: bench.judges })
          .from(bench)
          .where(eq(bench.id, graph.benchId));

        const names = [
          ...people.flatMap((p) => [p.name, ...p.aliases]),
          ...titles.flatMap((t) => [t.p, t.r]).filter((n): n is string => n !== null),
          ...(b?.judges ?? []),
        ];
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) expect(FICTIONAL_NAME_LIST, name).toContain(name);
      });
    });
  });

  it('contains no name literal outside FICTIONAL_NAMES', () => {
    const source = readFileSync(FIXTURES_SOURCE, 'utf8');
    const start = source.indexOf('export const FICTIONAL_NAMES = {');
    const end = source.indexOf('} as const;', start);
    expect(start).toBeGreaterThan(-1);
    const catalogue = source.slice(start, end);
    const rest = source.slice(0, start) + source.slice(end);

    // Every literal in the catalogue is marked fictional.
    const literals = [...catalogue.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(literals.sort()).toEqual([...FICTIONAL_NAME_LIST].sort());
    for (const name of literals) expect(name).toMatch(/\(fictional\)$/);

    // Outside it, name-bearing columns are never set from a literal.
    expect(rest).not.toMatch(
      /\b(name|aliases|judges|titlePetitioner|titleRespondent)\s*:\s*\[?\s*['"`]/,
    );
    expect(FICTIONAL_NAMES.judges.length).toBeGreaterThan(0);
  });
});
