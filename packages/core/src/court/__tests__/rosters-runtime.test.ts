// The roster runtime wrappers (#434) on the app database, as the rosters actions call them: inside
// the action's own workspace scope. `previewRosterImportFor` parses a finalized upload of the
// workspace from the object store and refuses a clerk; `confirmRosterImportFor` asks before
// superseding the active roster, then confirms (committed) and runs bench-change detection with the
// job queue's delivery enqueue.
import { randomUUID } from 'node:crypto';

import { schema, withWorkspace } from '@causedeck/db';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import {
  buildBench,
  buildCourtHall,
  buildForum,
  buildListing,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMemoryObjectStore, type ObjectKey } from '@causedeck/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { madrasRosterPdf, MADRAS_EXPECTED } from '../__fixtures__/rosters.ts';

const jobs = vi.hoisted(() => ({ delivered: [] as unknown[] }));

vi.mock('@causedeck/db', async (original) => {
  const actual = await original<Record<string, unknown>>();
  const { testAppDb: appDb } = await import('@causedeck/db/testing');
  return { ...actual, db: appDb() };
});
vi.mock('../../jobs/index.ts', () => ({
  enqueueNotificationDelivery: (job: unknown) => {
    jobs.delivered.push(job);
    return Promise.resolve('job-id');
  },
}));

const runtime = await import('../../runtime/index.ts');

let t: TwoTenants;

beforeAll(async () => {
  t = await seedTwoTenants(testAppDb());
});

afterAll(closeTestDb);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected a WorkspaceError').toBeInstanceOf(Error);
  return (error as { code?: string }).code;
}

/** Run `fn` inside B's scope as `ub`, as `workspaceAction` runs the handler. */
const inB = <T>(fn: () => Promise<T>) =>
  runtime.inWorkspace({ workspaceId: t.b.id, userId: t.ub }, () => fn());

describe('previewRosterImportFor (#434)', () => {
  it("parses the workspace's uploaded roster PDF; a clerk is FORBIDDEN", async () => {
    const store = createMemoryObjectStore();
    const id = randomUUID();
    const key = `ws/${t.b.id}/document/2026/${id}` as ObjectKey;
    const body = await madrasRosterPdf();
    await store.put({ key, body, contentType: 'application/pdf' });
    const forumCode = await withWorkspace(testAppDb(), { workspaceId: t.b.id }, async (s) => {
      await s.insert(schema.blob).values({
        id,
        workspaceId: t.b.id,
        key,
        kind: 'document',
        filename: 'roster.pdf',
        size: body.byteLength,
        sha256: 'a'.repeat(64),
        mime: 'application/pdf',
        scanStatus: 'clean',
        createdBy: t.ub,
        finalizedAt: new Date(),
      });
      return (await buildForum(s, t.b.id)).code;
    });
    const preview = await inB(() =>
      runtime.previewRosterImportFor(
        { workspaceId: t.b.id, userId: t.ub, store },
        { blobId: id, forumCode },
      ),
    );
    expect(preview.forumCode).toBe(forumCode);
    expect(preview.candidates.map((c) => c.hallNo)).toEqual(MADRAS_EXPECTED.map((c) => c.hallNo));

    const clerk = randomUUID();
    await testAppDb()
      .insert(schema.user)
      .values({ id: clerk, name: 'Clerk', email: `${clerk}@example.test` });
    await withWorkspace(testAppDb(), { workspaceId: t.b.id }, (s) =>
      s.insert(schema.member).values({ organizationId: t.b.id, userId: clerk, role: 'clerk' }),
    );
    expect(
      await codeOf(
        runtime.previewRosterImportFor(
          { workspaceId: t.b.id, userId: clerk, store },
          { blobId: id, forumCode },
        ),
      ),
    ).toBe('FORBIDDEN');
    // An unknown upload id reads as missing.
    expect(
      await codeOf(
        runtime.previewRosterImportFor(
          { workspaceId: t.b.id, userId: t.ub, store },
          { blobId: randomUUID(), forumCode },
        ),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('confirmRosterImportFor (#434)', () => {
  it('asks before superseding, then confirms and detects bench changes', async () => {
    const built = await withWorkspace(testAppDb(), { workspaceId: t.b.id }, async (s) => {
      const forum = await buildForum(s, t.b.id);
      const hall = await buildCourtHall(s, t.b.id, { forumId: forum.id, hallNo: '1' });
      const a = await buildBench(s, t.b.id, {
        forumId: forum.id,
        judges: ['Justice A (fictional)'],
        benchKind: 'single',
      });
      const b = await buildBench(s, t.b.id, {
        forumId: forum.id,
        judges: ['Justice B (fictional)'],
        benchKind: 'single',
      });
      const matter = await buildMatter(s, t.b.id);
      const proceeding = await buildProceeding(s, t.b.id, {
        matterId: matter.id,
        forumId: forum.id,
      });
      await buildListing(s, t.b.id, {
        proceedingId: proceeding.id,
        listDate: '2026-10-10',
        hallId: hall.id,
      });
      return { forumId: forum.id, hallId: hall.id, a: a.id, b: b.id, proceedingId: proceeding.id };
    });
    const actor = { workspaceId: t.b.id, userId: t.ub };
    const first = await inB(() =>
      runtime.confirmRosterImportFor(actor, {
        forumId: built.forumId,
        effectiveFrom: '2026-09-01',
        entries: [{ hallNo: '1', hallId: built.hallId, benchId: built.a, portfolioText: '' }],
      }),
    );
    // The forum's first roster is the baseline: detection runs and finds nothing.
    expect(first).toMatchObject({ detection: 'ok', alerts: [] });
    expect(first.roster.roster.status).toBe('active');

    const next = {
      forumId: built.forumId,
      effectiveFrom: '2026-10-05',
      entries: [{ hallNo: '1', hallId: built.hallId, benchId: built.b, portfolioText: '' }],
    };
    expect(await codeOf(inB(() => runtime.confirmRosterImportFor(actor, next)))).toBe('CONFLICT');

    jobs.delivered.length = 0;
    const second = await inB(() =>
      runtime.confirmRosterImportFor(actor, { ...next, supersedeCurrent: true }),
    );
    expect(second.detection).toBe('ok');
    expect(second.alerts.map((a) => [a.proceedingId, a.oldBenchId, a.newBenchId])).toEqual([
      [built.proceedingId, built.a, built.b],
    ]);
    expect(jobs.delivered.length).toBeGreaterThan(0);
    const rosters = await withWorkspace(testAppDb(), { workspaceId: t.b.id }, (s) =>
      s
        .select({ id: schema.benchRoster.id, status: schema.benchRoster.status })
        .from(schema.benchRoster)
        .orderBy(schema.benchRoster.effectiveFrom),
    );
    const mine = rosters.filter((r) =>
      [first.roster.roster.id, second.roster.roster.id].includes(r.id),
    );
    expect(mine.map((r) => r.status)).toEqual(['superseded', 'active']);
  });
});
