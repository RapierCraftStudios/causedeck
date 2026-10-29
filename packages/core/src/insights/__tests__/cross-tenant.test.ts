// Practice insights (#85) across workspaces: B cannot read A's figures, and A's events never move
// B's results. Also the visibility matrix and the static review for forbidden dimensions.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { failure } from '../../__tests__/fixtures.ts';
import { getPracticeInsights, obligationHealth } from '../index.ts';

import { addDirection, addHearing, insightsWorld, NOW } from './helpers.ts';

const range = { range: 'custom', from: '2026-10-15', to: '2026-11-10' };

describe('insights across workspaces', () => {
  it("a user of B is denied A, and A's events never influence B's results", async () => {
    await withTestDb(async (tx) => {
      const a = await insightsWorld(tx);
      const b = await insightsWorld(tx);
      const deps = { db: tx, now: () => NOW };
      const h = await addHearing(a, {
        heldOn: '2026-11-02',
        appearing: [a.ownerMember],
        preparedAt: new Date('2026-11-01T10:00:00Z'),
      });
      await addDirection(a, { orderId: h.orderId, owner: a.ownerMember, dueDate: '2026-11-04' });

      const stranger = { userId: b.owner.userId, workspaceId: a.workspaceId };
      for (const call of [getPracticeInsights(deps, stranger, range), obligationHealth(deps, stranger, range)])
        expect(((await failure(call)) as { code: string }).code).toBe('NOT_FOUND');

      const seenByB = await getPracticeInsights(deps, b.owner, range);
      expect(seenByB.preparedKept).toMatchObject({ numerator: 0, denominator: 0, rate: null });
      expect(seenByB.obligations).toMatchObject({ due: 0, missed: 0, capturedTotal: 0 });
      expect(seenByB.preparedness.n).toBe(0);
      const seenByA = await getPracticeInsights(deps, a.owner, range);
      expect(seenByA.preparedKept.denominator).toBe(1);
      expect(seenByA.obligations.missed).toBe(1);
    });
  });

  it('owner and advocate see workspace totals, a junior their own, clerk and viewer none', async () => {
    await withTestDb(async (tx) => {
      const w = await insightsWorld(tx);
      const deps = { db: tx, now: () => NOW };
      expect((await getPracticeInsights(deps, w.owner, range)).scope).toBe('workspace');
      expect((await getPracticeInsights(deps, w.advocate, range)).scope).toBe('workspace');
      expect((await getPracticeInsights(deps, w.junior, range)).scope).toBe('own');
      for (const who of [w.clerk, w.viewer])
        expect(((await failure(getPracticeInsights(deps, who, range))) as { code: string }).code).toBe('FORBIDDEN');
    });
  });
});

describe('the insights module', () => {
  it('has no judge or bench dimension and no ranking or benchmark', () => {
    const files = readdirSync(path.join(import.meta.dirname, '..'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(import.meta.dirname, '..', f));
    expect(files.length).toBeGreaterThan(5);
    const found = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\b(judge|bench|leaderboard|benchmark|ranking)\b/gi)].map(
        (m) => `${path.basename(file)}: ${m[0]}`,
      ),
    );
    // The module's own comments state the rule; code never names the dimensions.
    expect(found.filter((line) => !line.includes('index.ts'))).toEqual([]);
  });
});
