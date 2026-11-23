// Cross-tenant statutes (#1125): user `ub`, working in workspace B, names workspace A when reading a
// section, its history, a section search or the top authorities. The tables read are global, so the
// only tenant boundary is the membership check: every call must be NOT_FOUND or FORBIDDEN
// (`denies`), and A's audit rows are unchanged. Kept beside services.test.ts and driven by the same
// registry, like move-preview.test.ts.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/statutes.test.ts';

interface Fixture extends TwoTenants {
  tx: Transaction;
  /** Run `fn` as `ub` inside workspace B's scope. */
  asB: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
}

type Case = (f: Fixture) => Promise<void>;

/** Rejects with a WorkspaceError whose code is NOT_FOUND or FORBIDDEN. */
async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected NOT_FOUND or FORBIDDEN').toBeInstanceOf(core.WorkspaceError);
  expect(['NOT_FOUND', 'FORBIDDEN']).toContain((error as core.WorkspaceError).code);
}

async function auditOf(f: Fixture, workspaceId: string) {
  return inWorkspace(f.tx, workspaceId, (s) =>
    s.select().from(schema.auditEvent).orderBy(schema.auditEvent.id),
  );
}

/** B, naming A's workspace, is denied and leaves A's audit rows unchanged. */
function deniedOnA(call: (s: Transaction, actor: core.StatutesActor) => Promise<unknown>): Case {
  return async (f) => {
    const before = await auditOf(f, f.a.id);
    await expectDenied(f.asB((s) => call(s, { workspaceId: f.a.id, userId: f.ub })));
    expect(await auditOf(f, f.a.id)).toEqual(before);
  };
}

const ref = { statute: 'indian penal code', section: '304a' };

const CASES: Record<string, Case> = {
  getSection: deniedOnA((s, actor) => core.getSection(s, actor, ref)),
  listSectionHistory: deniedOnA((s, actor) => core.listSectionHistory(s, actor, ref)),
  searchSections: deniedOnA((s, actor) => core.searchSections(s, actor, { query: 'negligence' })),
  topAuthoritiesForSection: deniedOnA((s, actor) => core.topAuthoritiesForSection(s, actor, ref)),
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant statutes: ub on workspace B against A (#1125)', () => {
  it('has a case for every service the registry points here', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((name) => !(name in CASES))).toEqual([]);
    expect(Object.keys(CASES).filter((name) => !registered.includes(name))).toEqual([]);
  });

  it.each(registered)('%s', async (name) => {
    const run = CASES[name];
    if (run === undefined) throw new Error(`no cross-tenant case for ${name}`);
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      await run({ ...seeded, tx, asB: (fn) => inWorkspace(tx, seeded.b.id, fn, seeded.ub) });
    });
  });
});
