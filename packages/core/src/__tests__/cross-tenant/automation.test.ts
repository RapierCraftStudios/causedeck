// Cross-tenant automation engine (#47): user `ub`, working in workspace B, calls every engine
// service with workspace A's ids and with A's workspace id. Each must be NOT_FOUND, FORBIDDEN or
// VALIDATION (`denies`), or touch only B's rows; A's proposals and activities stay as they were,
// and A's own owner can still use the service, so the probe is sound. Kept beside services.test.ts
// and driven by the same registry (`@causedeck/db/testing/cross-tenant-registry`), like
// next-date-choice.test.ts.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/automation.test.ts';
const CAPTURE = '00000000-0000-4000-8000-0000000000c9';
const RANDOM_ID = '00000000-0000-4000-8000-0000000000aa';

interface Fixture extends TwoTenants {
  tx: Transaction;
  /** Run `fn` as `ub` inside workspace B's scope. */
  asB: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
  proposalId: string;
  activityId: string;
}

type Case = (f: Fixture) => Promise<void>;

/** Rejects with a WorkspaceError whose code is NOT_FOUND, FORBIDDEN or VALIDATION. */
async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected NOT_FOUND, FORBIDDEN or VALIDATION').toBeInstanceOf(core.WorkspaceError);
  expect(['NOT_FOUND', 'FORBIDDEN', 'VALIDATION']).toContain((error as core.WorkspaceError).code);
}

function graphDeps(db: Database | Transaction) {
  const events: core.GraphEvent[] = [];
  return { deps: { db, events: { emit: (e: core.GraphEvent) => events.push(e) } }, events };
}

/** A's proposals and activities, all columns, for before/after checks. */
async function aRows(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, async (s) => ({
    proposals: await s
      .select()
      .from(schema.proposal)
      .where(eq(schema.proposal.workspaceId, f.a.id))
      .orderBy(schema.proposal.id),
    activities: await s
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, f.a.id))
      .orderBy(schema.activity.id),
  }));
}

/** ub claims A, with and without B's scope: denied, no events, A unchanged. */
async function claimsAreDenied(
  f: Fixture,
  call: (deps: core.MatterGraphDeps, actor: core.GraphActor) => Promise<unknown>,
): Promise<void> {
  const before = await aRows(f);
  const { deps, events } = graphDeps(f.tx);
  await expectDenied(call(deps, { userId: f.ub, workspaceId: f.a.id }));
  await expectDenied(f.asB((s) => call({ ...deps, db: s }, { userId: f.ub, workspaceId: f.a.id })));
  expect(events).toEqual([]);
  expect(await aRows(f)).toEqual(before);
}

const task = {
  kind: 'task',
  source: { type: 'manual', input: 'form' },
  payload: { title: 'Probe', dueDate: '2099-01-05' },
};

const CASES: Record<string, Case> = {
  submitProposals: async (f) => {
    await claimsAreDenied(f, (deps, actor) => core.submitProposals(deps, actor, [task]));
    // From B, an attach naming A's document and matter fails to apply and leaves A's document alone.
    const { deps } = graphDeps(f.tx);
    const documentId = f.a.rows.document?.documentId;
    const matterId = f.a.rows.matter?.matterId;
    if (documentId === undefined || matterId === undefined)
      throw new Error('two-tenant seed missing');
    const before = await inWorkspace(f.tx, f.a.id, (s) => s.select().from(schema.document));
    const { items } = await core.submitProposals(deps, { userId: f.ub, workspaceId: f.b.id }, [
      {
        kind: 'document_attach',
        source: { type: 'deterministic', input: 'document' },
        confidence: 0.99,
        match: { score: 1, exact: 'cnr' },
        payload: { documentId, matterId },
      },
    ]);
    expect(items[0]?.status).toBe('needs_you');
    expect(await inWorkspace(f.tx, f.a.id, (s) => s.select().from(schema.document))).toEqual(
      before,
    );
    // A's own owner can submit.
    const own = await core.submitProposals(deps, { userId: f.ua, workspaceId: f.a.id }, [task]);
    expect(own.items[0]?.status).toBe('proposed');
  },
  acceptProposal: async (f) => {
    await claimsAreDenied(f, (deps, actor) =>
      core.acceptProposal(deps, actor, { proposalId: f.proposalId }),
    );
    const { deps } = graphDeps(f.tx);
    await expectDenied(
      core.acceptProposal(
        deps,
        { userId: f.ub, workspaceId: f.b.id },
        { proposalId: f.proposalId },
      ),
    );
  },
  editAndAccept: async (f) => {
    const input = { proposalId: f.proposalId, payload: { title: 'Changed' } };
    await claimsAreDenied(f, (deps, actor) => core.editAndAccept(deps, actor, input));
    const { deps } = graphDeps(f.tx);
    await expectDenied(core.editAndAccept(deps, { userId: f.ub, workspaceId: f.b.id }, input));
  },
  dismissProposal: async (f) => {
    await claimsAreDenied(f, (deps, actor) =>
      core.dismissProposal(deps, actor, { proposalId: f.proposalId }),
    );
    const { deps } = graphDeps(f.tx);
    await expectDenied(
      core.dismissProposal(
        deps,
        { userId: f.ub, workspaceId: f.b.id },
        { proposalId: f.proposalId },
      ),
    );
    const row = await core.dismissProposal(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { proposalId: f.proposalId },
    );
    expect(row.status).toBe('dismissed');
  },
  applyAutomatically: async (f) => {
    await claimsAreDenied(f, (deps, actor) =>
      core.applyAutomatically(deps, actor, { proposalId: f.proposalId }),
    );
    const { deps } = graphDeps(f.tx);
    await expectDenied(
      core.applyAutomatically(
        deps,
        { userId: f.ub, workspaceId: f.b.id },
        { proposalId: f.proposalId },
      ),
    );
  },
  expireProposals: async (f) => {
    await claimsAreDenied(f, (deps, actor) =>
      core.expireProposals(deps, actor, { before: new Date('2100-01-01') }),
    );
    // From B it expires B's own proposals only.
    const { deps } = graphDeps(f.tx);
    await core.expireProposals(
      deps,
      { userId: f.ub, workspaceId: f.b.id },
      { before: new Date('2100-01-01') },
    );
    const [row] = (await aRows(f)).proposals.filter((p) => p.id === f.proposalId);
    expect(row?.status).toBe('proposed');
  },
  exportActivities: async (f) => {
    await claimsAreDenied(f, (deps, actor) => core.exportActivities(deps, actor));
    const { deps } = graphDeps(f.tx);
    const fromB = await core.exportActivities(deps, { userId: f.ub, workspaceId: f.b.id });
    expect(fromB.map((r) => r.id)).not.toContain(f.activityId);
    const fromA = await core.exportActivities(deps, { userId: f.ua, workspaceId: f.a.id });
    expect(fromA.map((r) => r.id)).toContain(f.activityId);
  },
  listProposalsForDigest: async (f) => {
    await claimsAreDenied(f, (deps, actor) => core.listProposalsForDigest(deps, actor));
    const { deps } = graphDeps(f.tx);
    const fromB = await core.listProposalsForDigest(deps, { userId: f.ub, workspaceId: f.b.id });
    expect(fromB.map((r) => r.id)).not.toContain(f.proposalId);
    const fromA = await core.listProposalsForDigest(deps, { userId: f.ua, workspaceId: f.a.id });
    expect(fromA.map((r) => r.id)).toContain(f.proposalId);
  },
  getAskFirst: async (f) => {
    await claimsAreDenied(f, (deps, actor) => core.getAskFirst(deps, actor));
    const { deps } = graphDeps(f.tx);
    // A's seeded dial is the owner's; B's owner sees only their own.
    expect(await core.getAskFirst(deps, { userId: f.ub, workspaceId: f.b.id })).toEqual(['task']);
    expect(await core.getAskFirst(deps, { userId: f.ua, workspaceId: f.a.id })).toEqual(['task']);
  },
  setAskFirst: async (f) => {
    await claimsAreDenied(f, (deps, actor) =>
      core.setAskFirst(deps, actor, { kind: 'task', askFirst: false }),
    );
    const { deps } = graphDeps(f.tx);
    const rows = await inWorkspace(f.tx, f.a.id, (s) =>
      s.select().from(schema.automationPreference),
    );
    expect(rows.every((r) => r.askFirst)).toBe(true);
    await core.setAskFirst(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { kind: 'task', askFirst: false },
    );
  },
  confirmActivity: async (f) => {
    await claimsAreDenied(f, (deps, actor) =>
      core.confirmActivity(deps, actor, { activityId: f.activityId }),
    );
    const { deps } = graphDeps(f.tx);
    await expectDenied(
      core.confirmActivity(
        deps,
        { userId: f.ub, workspaceId: f.b.id },
        { activityId: f.activityId },
      ),
    );
  },
  previewUndo: async (f) => {
    await claimsAreDenied(f, (deps, actor) =>
      core.previewUndo(deps, actor, { activityId: f.activityId }),
    );
    const { deps } = graphDeps(f.tx);
    await expectDenied(
      core.previewUndo(deps, { userId: f.ub, workspaceId: f.b.id }, { activityId: f.activityId }),
    );
    const own = await core.previewUndo(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { activityId: f.activityId },
    );
    expect(own.willRemove.map((i) => i.activityId)).toEqual([f.activityId]);
  },
  undoActivity: async (f) => {
    await claimsAreDenied(f, (deps, actor) =>
      core.undoActivity(deps, actor, { activityId: f.activityId }),
    );
    const { deps } = graphDeps(f.tx);
    await expectDenied(
      core.undoActivity(deps, { userId: f.ub, workspaceId: f.b.id }, { activityId: f.activityId }),
    );
  },
  undoCapture: async (f) => {
    await claimsAreDenied(f, (deps, actor) =>
      core.undoCapture(deps, actor, { captureId: CAPTURE }),
    );
    const { deps } = graphDeps(f.tx);
    const fromB = await core.undoCapture(
      deps,
      { userId: f.ub, workspaceId: f.b.id },
      { captureId: CAPTURE },
    );
    expect(fromB).toEqual({ undone: [], skipped: [] });
  },
  getInbox: async (f) => {
    // ub claims A: denied, and B's own inbox never shows A's proposals.
    await claimsAreDenied(f, (deps, actor) => core.getInbox(deps, actor));
    const { deps } = graphDeps(f.tx);
    const inbox = await core.getInbox(deps, { userId: f.ub, workspaceId: f.b.id });
    const aProposal = f.proposalId;
    expect(inbox.needsYou.map((item) => item.proposalId)).not.toContain(aProposal);
  },
  reassignCapture: async (f) => {
    const matterId = f.a.rows.matter?.matterId ?? RANDOM_ID;
    await claimsAreDenied(f, (deps, actor) =>
      core.reassignCapture(deps, actor, { captureId: CAPTURE, matterId }),
    );
    const { deps } = graphDeps(f.tx);
    await expectDenied(
      core.reassignCapture(
        deps,
        { userId: f.ub, workspaceId: f.b.id },
        { captureId: CAPTURE, matterId },
      ),
    );
  },
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant automation engine: ub on workspace B against A (#47)', () => {
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
      const proposalId = seeded.a.rows.proposal?.proposalId;
      const activityId = seeded.a.rows.activity?.activityId;
      if (proposalId === undefined || activityId === undefined) {
        throw new Error('two-tenant automation seed missing');
      }
      await run({
        ...seeded,
        tx,
        asB: (fn) => inWorkspace(tx, seeded.b.id, fn, seeded.ub),
        proposalId,
        activityId,
      });
    });
  });
});
