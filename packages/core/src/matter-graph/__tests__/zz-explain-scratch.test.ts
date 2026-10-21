import { insertSyntheticMatterSet, SYNTHETIC_MARKETS, syntheticMatterSet } from '@causedeck/db/seed/synthetic';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { SearchMattersInput } from '@causedeck/validators/matter-graph-inputs';
import { sql } from 'drizzle-orm';
import { it } from 'vitest';
import { newWorkspace } from '../../__tests__/fixtures.ts';
import { searchMattersQuery, upcomingNextDates } from '../read-models.ts';
it('explains', { timeout: 300_000 }, async () => {
  await withTestDb(async (tx) => {
    const { ownerId, workspaceId } = await newWorkspace(tx);
    const forumIds = await inWorkspace(tx, workspaceId, async (s) => [(await buildForum(s, workspaceId)).id]);
    for (const market of SYNTHETIC_MARKETS) await insertSyntheticMatterSet(tx, syntheticMatterSet({ market, workspaceId, forumIds, today: '2026-10-21' }));
    await inWorkspace(tx, workspaceId, async (s) => {
      await s.execute(sql`analyze matter, proceeding, listing, person, role_edge`);
      const q = searchMattersQuery(s, { userId: ownerId, workspaceId, role: 'owner' }, {}, SearchMattersInput.parse({}), await upcomingNextDates(s, workspaceId, '2026-10-21'));
      const rows = await s.execute<{ 'QUERY PLAN': string }>(sql`explain (analyze, costs off) ${q.getSQL()}`);
      process.stderr.write(rows.map((r) => r['QUERY PLAN']).join('\n') + '\n');
    });
  });
});
