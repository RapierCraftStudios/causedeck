// The obligation clerk view (R16 of #67, #724): `obligation_clerk_v` returns every obligation with
// `description` NULL on strategy rows. The clerk role has no privilege on `obligation`, so inside
// `withWorkspace({ dbRole: 'clerk' })` the table is unreadable and the view is the only way in, still
// under the table's row-level security. The app role reads and writes the table as before.
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { withWorkspace } from '../../rls.ts';
import { obligation } from '../../schema/index.ts';
import { inWorkspace, withTestDb } from '../../testing/index.ts';
import { buildMatter } from '../../testing/matter-graph-fixtures.ts';
import { newWorkspace, sqlState } from './fixtures.ts';

const DENIED = '42501';

async function seed(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const ws = await newWorkspace(tx);
  const matter = await inWorkspace(tx, ws.id, (s) => buildMatter(s, ws.id));
  const rows = await inWorkspace(tx, ws.id, (s) =>
    s
      .insert(obligation)
      .values(
        [
          { description: 'Settle at 40', strategy: true },
          { description: 'File vakalatnama', strategy: false },
        ].map((r) => ({
          ...r,
          workspaceId: ws.id,
          matterId: matter.id,
          source: 'internal' as const,
          sourceType: 'manual' as const,
        })),
      )
      .returning({ id: obligation.id, strategy: obligation.strategy }),
  );
  return { ws, rows };
}

describe('obligation clerk view', () => {
  it('as clerk: the table is denied, the view hides strategy descriptions only', async () => {
    await withTestDb(async (tx) => {
      const { ws } = await seed(tx);
      const asClerk = <T>(fn: Parameters<typeof withWorkspace<T>>[2]) =>
        withWorkspace(tx, { workspaceId: ws.id, dbRole: 'clerk' }, fn);
      expect(await sqlState(asClerk((t) => t.execute(sql`select * from obligation`)))).toBe(DENIED);
      const rows = await asClerk((t) =>
        t.execute<{ description: string | null; strategy: boolean }>(
          sql`select description, strategy from obligation_clerk_v order by strategy desc`,
        ),
      );
      expect(rows.map((r) => ({ ...r }))).toEqual([
        { description: null, strategy: true },
        { description: 'File vakalatnama', strategy: false },
      ]);
      expect(
        await sqlState(
          asClerk((t) => t.execute(sql`update obligation_clerk_v set basis = 'x' returning 1`)),
        ),
      ).toBe(DENIED);
    });
  });

  it('keeps row-level security through the view: another workspace sees none of it', async () => {
    await withTestDb(async (tx) => {
      const { ws } = await seed(tx);
      const other = await newWorkspace(tx);
      const seen = await withWorkspace(tx, { workspaceId: other.id, dbRole: 'clerk' }, (t) =>
        t.execute(sql`select 1 from obligation_clerk_v where workspace_id = ${ws.id}::uuid`),
      );
      expect(seen).toHaveLength(0);
    });
  });

  it('without dbRole the app role still reads the full description', async () => {
    await withTestDb(async (tx) => {
      const { ws } = await seed(tx);
      const rows = await withWorkspace(tx, { workspaceId: ws.id }, (t) =>
        t.execute<{ description: string }>(sql`select description from obligation where strategy`),
      );
      expect(rows.map((r) => r.description)).toEqual(['Settle at 40']);
    });
  });
});
