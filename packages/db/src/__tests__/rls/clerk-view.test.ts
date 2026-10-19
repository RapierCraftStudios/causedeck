// Clerk column-scoped views (#233): `app_clerk_view()` (migration 0018) exposes a tenant table to the
// `causedeck_clerk` role through a view without its strategy columns. Inside
// `withWorkspace({ dbRole: 'clerk' })` the base table is not readable (no grant) while the view is,
// still under the base table's row-level security. The fixture table lives in a scratch database
// so it never reaches the shared one (the cross-tenant registry introspects it).
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database, type Transaction } from '../../client.ts';
import { runMigrations } from '../../migrate.ts';
import { createOwnerDb } from '../../owner.ts';
import { tenantPolicy } from '../../rls-policies.ts';
import { CLERK_DB_ROLE, withWorkspace } from '../../rls.ts';
import { CLERK_ROLE } from '../../testing/container.ts';
import { createScratchDatabase, testDatabaseUrls } from '../../testing/index.ts';
import { sqlState } from './fixtures.ts';

const DENIED = '42501';
const FIXTURE = 'clerk_fixture';
const VIEW = 'clerk_fixture_clerk_view';

const wsA = randomUUID();
const wsB = randomUUID();
let app: Database;
let ownerUrl: string;
let drop: (() => Promise<void>) | undefined;

async function asOwner(statements: string[], workspaceId?: string): Promise<void> {
  const owner = createOwnerDb(new Secret(ownerUrl));
  try {
    await owner.transaction(async (tx) => {
      if (workspaceId !== undefined) {
        await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
      }
      for (const statement of statements) await tx.execute(sql.raw(statement));
    });
  } finally {
    await owner.$client.end();
  }
}

/** `fn` in its own transaction, scoped to `workspaceId` as the clerk role. */
function asClerk<T>(workspaceId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withWorkspace(app, { workspaceId, dbRole: 'clerk' }, fn);
}

beforeAll(async () => {
  const scratch = await createScratchDatabase(
    testDatabaseUrls(),
    `clerk_view_${randomUUID().replaceAll('-', '')}`,
  );
  drop = scratch.drop;
  ownerUrl = scratch.owner;
  await runMigrations({ url: new Secret(scratch.owner) });
  await asOwner([
    `CREATE TABLE ${FIXTURE} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, title text NOT NULL, strategy_notes text)`,
    ...tenantPolicy(FIXTURE),
    `SELECT app_clerk_view('${FIXTURE}', '${VIEW}', ARRAY['strategy_notes'])`,
  ]);
  for (const ws of [wsA, wsB]) {
    await asOwner(
      [
        `INSERT INTO ${FIXTURE} (workspace_id, title, strategy_notes) VALUES ('${ws}', 'title ${ws}', 'secret ${ws}')`,
      ],
      ws,
    );
  }
  app = createDb({ url: new Secret(scratch.app), role: 'app', max: 2 });
});

afterAll(async () => {
  await app.$client.end();
  await drop?.();
});

describe('clerk column-scoped view', () => {
  it('names the role the init SQL provisions', () => {
    expect(CLERK_DB_ROLE).toBe(CLERK_ROLE);
  });

  it('as clerk: the base table is not readable, the view is, without strategy_notes', async () => {
    expect(
      await sqlState(asClerk(wsA, (tx) => tx.execute(sql.raw(`select * from ${FIXTURE}`)))),
    ).toBe(DENIED);
    expect(
      await sqlState(
        asClerk(wsA, (tx) => tx.execute(sql.raw(`select strategy_notes from ${FIXTURE}`))),
      ),
    ).toBe(DENIED);
    const rows = await asClerk(wsA, (tx) => tx.execute(sql.raw(`select * from ${VIEW}`)));
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: expect.any(String) as unknown, workspace_id: wsA, title: `title ${wsA}` },
    ]);
  });

  it('keeps row-level security through the view: only the scoped workspace', async () => {
    const seen = await asClerk(wsB, (tx) =>
      tx.execute<{ ws: string }>(sql.raw(`select workspace_id as ws from ${VIEW}`)),
    );
    expect(seen.map((r) => r.ws)).toEqual([wsB]);
    const none = await asClerk(wsA, (tx) =>
      tx.execute(sql.raw(`select 1 from ${VIEW} where workspace_id = '${wsB}'`)),
    );
    expect(none).toHaveLength(0);
  });

  it('the view is read-only for the clerk', async () => {
    expect(
      await sqlState(
        asClerk(wsA, (tx) => tx.execute(sql.raw(`update ${VIEW} set title = 'x' returning 1`))),
      ),
    ).toBe(DENIED);
  });

  it('without dbRole the app role still reads the base table', async () => {
    const rows = await withWorkspace(app, { workspaceId: wsA }, (tx) =>
      tx.execute<{ notes: string; who: string }>(
        sql.raw(`select strategy_notes as notes, current_user as who from ${FIXTURE}`),
      ),
    );
    expect(rows).toEqual([{ notes: `secret ${wsA}`, who: 'causedeck_app' }]);
  });

  it('a nested scope never widens a clerk scope, and a savepoint restores the outer role', async () => {
    const who = (tx: Transaction) =>
      tx.execute<{ who: string }>(sql`select current_user as who`).then(([r]) => r?.who);
    await asClerk(wsA, async (tx) => {
      expect(await who(tx)).toBe(CLERK_DB_ROLE);
      expect(await withWorkspace(tx, { workspaceId: wsA }, who)).toBe(CLERK_DB_ROLE);
      expect(await who(tx)).toBe(CLERK_DB_ROLE);
    });
    await withWorkspace(app, { workspaceId: wsA }, async (tx) => {
      expect(await who(tx)).toBe('causedeck_app');
      expect(await withWorkspace(tx, { workspaceId: wsA, dbRole: 'clerk' }, who)).toBe(
        CLERK_DB_ROLE,
      );
      expect(await who(tx)).toBe('causedeck_app');
      expect((await tx.execute(sql.raw(`select 1 from ${FIXTURE}`))).length).toBe(1);
    });
  });

  it('the clerk keeps the app role privileges elsewhere, append-only revokes included', async () => {
    const rows = await asClerk(wsA, (tx) => tx.execute(sql`select 1 from matter_restriction`));
    expect(rows).toHaveLength(0);
    expect(
      await sqlState(asClerk(wsA, (tx) => tx.execute(sql`delete from audit_event returning 1`))),
    ).toBe(DENIED);
    const [ws] = await asClerk(wsA, (tx) =>
      tx.execute<{ ws: string }>(sql`select app_current_workspace()::text as ws`),
    );
    expect(ws?.ws).toBe(wsA);
  });

  it('the helper is migration-only and refuses unsafe base tables', async () => {
    expect(
      await sqlState(
        withWorkspace(app, { workspaceId: wsA }, (tx) =>
          tx.execute(sql.raw(`select app_clerk_view('${FIXTURE}', 'x_view', ARRAY['title'])`)),
        ),
      ),
    ).toBe(DENIED);
    await expect(
      asOwner([
        'CREATE TABLE no_force (id int, workspace_id uuid, notes text)',
        `SELECT app_clerk_view('no_force', 'no_force_view', ARRAY['notes'])`,
      ]),
    ).rejects.toThrow();
    await expect(
      asOwner([`SELECT app_clerk_view('${FIXTURE}', 'bad_view', ARRAY['nope'])`]),
    ).rejects.toThrow();
  });

  it('rejects an unknown dbRole', async () => {
    await expect(
      withWorkspace(app, { workspaceId: wsA, dbRole: 'owner' as 'clerk' }, () =>
        Promise.resolve(1),
      ),
    ).rejects.toThrow(TypeError);
  });
});
