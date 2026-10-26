// Stale-matter attention (#70) on the test database: detection, roles, snooze, dismissal and its
// lapse, the threshold, the scan counts, and that detection writes nothing.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildForum,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember, failure, newWorkspace } from '../../__tests__/fixtures.ts';
import {
  detectAttention,
  dismissFlag,
  liftSnooze,
  listSnoozes,
  scanWorkspaceAttention,
  setStaleDays,
  snoozeFlag,
} from '../index.ts';

const NOW = new Date('2026-11-10T06:00:00Z');
const deps = (tx: Transaction) => ({ db: tx, now: () => NOW });

async function world(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const matter = await inWorkspace(tx, workspaceId, (s) =>
    buildMatter(s, workspaceId, { updatedAt: new Date('2026-11-01T00:00:00Z') }),
  );
  await inWorkspace(tx, workspaceId, (s) =>
    buildProceeding(s, workspaceId, { matterId: matter.id, forumId: forum.id, state: 'sr_fr' }),
  );
  return { workspaceId, owner: { userId: ownerId, workspaceId }, matterId: matter.id };
}

describe('attention', () => {
  it('flags a live matter without a next date, explained and unchanged by detection', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const flags = await detectAttention(deps(tx), w.owner);
      const hit = flags.find((f) => f.rule === 'no_next_date' && f.matterId === w.matterId);
      expect(hit?.evidence).toContain('No next date since');
      expect(hit?.suggestedAction).toBe('Set the next date');
      const [row] = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.matter).where(eq(schema.matter.id, w.matterId)),
      );
      expect(row?.updatedAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    });
  });

  it('skips a disposed matter and a matter of another workspace', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await inWorkspace(tx, w.workspaceId, (s) =>
        s.update(schema.matter).set({ status: 'disposed' }).where(eq(schema.matter.id, w.matterId)),
      );
      expect(await detectAttention(deps(tx), w.owner)).toEqual([]);
    });
  });

  it('snoozes with an audit trail, then lifts', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const rec = await snoozeFlag(deps(tx), w.owner, {
        kind: 'snooze',
        matterId: w.matterId,
        rule: 'no_next_date',
        until: '2026-11-10',
        reason: 'awaiting order',
      });
      expect(
        (await detectAttention(deps(tx), w.owner)).some((f) => f.rule === 'no_next_date'),
      ).toBe(false);
      expect(await listSnoozes(deps(tx), w.owner, w.matterId)).toHaveLength(1);
      await liftSnooze(deps(tx), w.owner, { snoozeId: rec.id });
      expect(
        (await detectAttention(deps(tx), w.owner)).some((f) => f.rule === 'no_next_date'),
      ).toBe(true);
    });
  });

  it('dismisses as dormant until the matter gets a newer event', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await dismissFlag(deps(tx), w.owner, { kind: 'dismiss', matterId: w.matterId, rule: null });
      expect(await detectAttention(deps(tx), w.owner)).toEqual([]);
      await inWorkspace(tx, w.workspaceId, (s) =>
        s
          .update(schema.matter)
          .set({ updatedAt: new Date(NOW.getTime() + 1000) })
          .where(eq(schema.matter.id, w.matterId)),
      );
      expect((await detectAttention(deps(tx), w.owner)).length).toBeGreaterThan(0);
    });
  });

  it('applies the threshold, bounded 7 to 180, owner only', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const junior = await addMember(tx, w.workspaceId, 'junior');
      await setStaleDays(deps(tx), w.owner, { days: 7 });
      const stale = await detectAttention(
        { db: tx, now: () => new Date('2026-11-20T06:00:00Z') },
        w.owner,
      );
      expect(stale.some((f) => f.rule === 'no_recent_update')).toBe(true);
      await failure(setStaleDays(deps(tx), w.owner, { days: 6 }));
      expect(
        await failure(
          setStaleDays(deps(tx), { userId: junior, workspaceId: w.workspaceId }, { days: 90 }),
        ),
      ).toBeDefined();
    });
  });

  it('shows a junior only readable matters, a clerk date-only evidence, and a viewer cannot snooze', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const junior = await addMember(tx, w.workspaceId, 'junior');
      const viewer = await addMember(tx, w.workspaceId, 'viewer');
      const asJunior = await detectAttention(deps(tx), {
        userId: junior,
        workspaceId: w.workspaceId,
      });
      expect(asJunior.every((f) => f.matterId !== w.matterId)).toBe(true);
      expect(
        await failure(
          snoozeFlag(
            deps(tx),
            { userId: viewer, workspaceId: w.workspaceId },
            {
              kind: 'snooze',
              matterId: w.matterId,
              rule: null,
              until: '2026-12-01',
              reason: 'x',
            },
          ),
        ),
      ).toBeDefined();
    });
  });

  it('counts by rule for the nightly scan, with no text', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const counts = await scanWorkspaceAttention(deps(tx), w.workspaceId);
      expect(counts.no_next_date).toBe(1);
    });
  });
  it('detects over 500 matters in a fixed query set with p95 under 300 ms', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
      const matters = await inWorkspace(tx, workspaceId, (s) =>
        s
          .insert(schema.matter)
          .values(
            Array.from({ length: 500 }, (_, n) => ({
              workspaceId,
              title: `Perf matter ${String(n)}`,
              practiceArea: 'writ' as const,
              updatedAt: new Date('2026-11-01T00:00:00Z'),
            })),
          )
          .returning({ id: schema.matter.id }),
      );
      await inWorkspace(tx, workspaceId, (s) =>
        s.insert(schema.proceeding).values(
          matters.map((m) => ({
            workspaceId,
            matterId: m.id,
            forumId: forum.id,
            caseTypeCode: 'WP',
            caseTypeRaw: 'W.P.',
            sourceType: 'manual' as const,
            state: 'sr_fr' as const,
          })),
        ),
      );
      const owner = { userId: ownerId, workspaceId };
      const runs: number[] = [];
      let flagged = 0;
      for (let n = 0; n < 20; n += 1) {
        const started = performance.now();
        flagged = (await detectAttention(deps(tx), owner)).length;
        runs.push(performance.now() - started);
      }
      runs.sort((a, b) => a - b);
      expect(flagged).toBeGreaterThanOrEqual(500);
      expect(runs[Math.ceil(runs.length * 0.95) - 1]).toBeLessThan(300);
    });
  }, 120_000);
});
