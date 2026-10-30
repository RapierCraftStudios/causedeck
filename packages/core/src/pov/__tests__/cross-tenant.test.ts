// Proof-of-value (#86) across workspaces: B cannot read A's ratings, the aggregate or the report,
// and a member of A sees only A's own rows. The per-service denial cases run in the shared suite.
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { addMember, failure } from '../../__tests__/fixtures.ts';
import { buildPovReport, listPov, povAggregate, recordPreparedness } from '../index.ts';

import { NOW, povWorld } from './helpers.ts';

describe('pov across workspaces', () => {
  it("a user of workspace B is denied A, and A's aggregate holds only A", async () => {
    await withTestDb(async (tx) => {
      const a = await povWorld(tx);
      const b = await povWorld(tx);
      const deps = { db: tx, now: () => NOW };
      await recordPreparedness(deps, a.owner, { hearingId: a.hearings[0] as string, rating: 5 });
      const stranger = { userId: b.owner.userId, workspaceId: a.workspaceId };
      for (const call of [
        listPov(deps, stranger),
        povAggregate(deps, stranger),
        buildPovReport(deps, stranger),
      ])
        expect(((await failure(call)) as { code: string }).code).toBe('NOT_FOUND');
      expect((await povAggregate(deps, b.owner)).preparedness.count).toBe(0);
      expect((await povAggregate(deps, a.owner)).preparedness.count).toBe(1);
      const junior = {
        userId: await addMember(tx, a.workspaceId, 'junior'),
        workspaceId: a.workspaceId,
      };
      expect(((await failure(povAggregate(deps, junior))) as { code: string }).code).toBe(
        'FORBIDDEN',
      );
    });
  });
});
