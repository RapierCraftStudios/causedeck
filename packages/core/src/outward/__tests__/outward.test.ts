// The outward-draft service on the test database: compose from confirmed facts with provenance,
// the unconfirmed flag, template-only for a sensitive matter or a gateway failure, the client
// requirement, tones, versions with a diff, the share log and tenant isolation.
import type { AiGateway } from '@causedeck/ai';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildForum,
  buildHearing,
  buildListing,
  buildMatter,
  buildObligation,
  buildPerson,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { failure, newWorkspace } from '../../__tests__/fixtures.ts';
import { composeUpdate, recordCopied, recordShared, saveEdit } from '../index.ts';

const NOW = new Date('2026-11-10T06:00:00Z');

function fakeGateway(behaviour: 'ok' | 'residency') {
  const calls: unknown[] = [];
  const gateway = {
    run(task: string, input: unknown, ctx: unknown) {
      calls.push({ task, input, ctx });
      if (behaviour === 'residency') return Promise.reject(new Error('residency violation'));
      return Promise.resolve({
        output: {
          blocks: [
            { kind: 'opening', text: 'Dear client, here is the latest.' },
            { kind: 'closing', text: 'We recommend you pay the fee of Rs 5000.' },
          ],
        },
      });
    },
  } as unknown as AiGateway;
  return { gateway, calls };
}
// A ticking clock keeps version order deterministic.
let tick = 0;
const deps = (tx: Transaction, gateway?: AiGateway) => ({
  db: tx,
  now: () => new Date(NOW.getTime() + 1000 * tick++),
  ...(gateway ? { gateway } : {}),
});

async function world(tx: Transaction, sensitive = false) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const owner = { userId: ownerId, workspaceId };
  const g = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const matter = await buildMatter(s, workspaceId, { sensitive });
    const proceeding = await buildProceeding(s, workspaceId, {
      matterId: matter.id,
      forumId: forum.id,
      state: 'sr_fr',
    });
    const listing = await buildListing(s, workspaceId, { proceedingId: proceeding.id });
    const confirmed = await buildHearing(s, workspaceId, {
      listingId: listing.id,
      outcome: 'Adjourned for arguments',
      nextDateConfirmed: '2026-12-12',
      confirmationState: 'confirmed',
    });
    const proposed = await buildHearing(s, workspaceId, {
      listingId: listing.id,
      nextDateProposed: '2026-12-20',
      confirmationState: 'proposed',
    });
    const client = await buildPerson(s, workspaceId, { kind: 'client' });
    const party = await buildPerson(s, workspaceId, { kind: 'party' });
    await buildObligation(s, workspaceId, {
      matterId: matter.id,
      source: 'order_direction',
      description: 'File the counter affidavit',
      dueDate: '2026-11-20',
      confirmationState: 'confirmed',
    });
    return { matter, confirmed, proposed, client, party };
  });
  return { workspaceId, owner, ...g };
}

const request = (w: Awaited<ReturnType<typeof world>>, extra: Record<string, unknown> = {}) => ({
  matterId: w.matter.id,
  hearingId: w.confirmed.id,
  audience: 'client',
  clientPersonId: w.client.id,
  ...extra,
});

describe('outward drafts', () => {
  it('composes from confirmed facts with provenance and drops a guarded model block', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { gateway, calls } = fakeGateway('ok');
      const draft = await composeUpdate(deps(tx, gateway), w.owner, request(w));
      expect(calls).toHaveLength(1);
      expect(draft.templateOnly).toBe(false);
      expect(draft.body).toContain('Dear client, here is the latest.');
      expect(draft.body).not.toContain('recommend');
      expect(draft.body).toContain('12 December 2026');
      expect(draft.body).not.toContain('to be confirmed');
      expect(draft.body).toContain('File the counter affidavit');
      const hearingFact = draft.facts.find((f) => f.kind === 'next_date');
      expect(hearingFact?.provenance).toMatchObject({
        table: 'hearing',
        recordId: w.confirmed.id,
      });
    });
  });

  it('flags an unconfirmed next date as to be confirmed', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const draft = await composeUpdate(
        deps(tx, fakeGateway('ok').gateway),
        w.owner,
        request(w, { hearingId: w.proposed.id }),
      );
      expect(draft.body).toContain('(to be confirmed)');
      expect(draft.facts.find((f) => f.kind === 'next_date')?.confirmed).toBe(false);
    });
  });

  it('is template-only for a sensitive matter and makes no model call', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, true);
      const { gateway, calls } = fakeGateway('ok');
      const draft = await composeUpdate(deps(tx, gateway), w.owner, request(w));
      expect(calls).toHaveLength(0);
      expect(draft.templateOnly).toBe(true);
    });
  });

  it('falls back to the template when the gateway refuses (residency, budget)', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const { gateway, calls } = fakeGateway('residency');
      const draft = await composeUpdate(deps(tx, gateway), w.owner, request(w));
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ task: 'outward_update' });
      expect(draft.templateOnly).toBe(true);
      expect(draft.body).toContain('12 December 2026');
    });
  });

  it('requires a client contact of kind client for the client audience', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const d = deps(tx, fakeGateway('ok').gateway);
      expect(
        await failure(composeUpdate(d, w.owner, request(w, { clientPersonId: undefined }))),
      ).toMatchObject({
        code: 'VALIDATION',
      });
      expect(
        await failure(composeUpdate(d, w.owner, request(w, { clientPersonId: w.party.id }))),
      ).toBeDefined();
    });
  });

  it('writes tone and language variants from templates', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, true);
      const d = deps(tx);
      const brief = await composeUpdate(d, w.owner, request(w, { tone: 'brief' }));
      const formal = await composeUpdate(d, w.owner, request(w, { tone: 'formal' }));
      expect(brief.body).not.toBe(formal.body);
      const ta = await composeUpdate(d, w.owner, request(w, { language: 'ta' }));
      const kn = await composeUpdate(d, w.owner, request(w, { language: 'kn' }));
      expect(/[஀-௿]/u.test(ta.body)).toBe(true);
      expect(/[ಀ-೿]/u.test(kn.body)).toBe(true);
    });
  });

  it('versions edits with a diff and logs only an explicit share', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx, true);
      const d = deps(tx);
      const draft = await composeUpdate(d, w.owner, request(w));
      const edit = await saveEdit(d, w.owner, {
        draftId: draft.draftId,
        body: `${draft.body}\nI advise you to wait.`,
      });
      expect(edit.warnings.length).toBeGreaterThan(0);
      expect(edit.diff.some((p) => p.op === 'insert')).toBe(true);
      const shared = await recordShared(d, w.owner, { draftId: draft.draftId, channel: 'mailto' });
      expect(shared.finalVersionId).toBe(edit.versionId);
      await recordCopied(d, w.owner, { draftId: draft.draftId });
      const read = await inWorkspace(tx, w.workspaceId, async (s) => ({
        versions: await s.select().from(schema.outwardDraftVersion),
        logs: await s.select().from(schema.outwardShareLog),
        row: (
          await s
            .select()
            .from(schema.outwardDraft)
            .where(eq(schema.outwardDraft.id, draft.draftId))
        )[0],
        events: await s
          .select({ action: schema.auditEvent.action })
          .from(schema.auditEvent)
          .where(and(eq(schema.auditEvent.workspaceId, w.workspaceId))),
      }));
      expect(read.versions).toHaveLength(2);
      expect(read.logs.map((l) => l.channel).sort()).toEqual(['clipboard', 'mailto']);
      expect(read.row?.status).toBe('shared');
      const actions = read.events.map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining(['outward.prepared', 'outward.edited', 'outward.shared']),
      );
    });
  });

  it('denies workspace B on workspace A drafts and leaves A unchanged', async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx, true);
      const b = await world(tx, true);
      const d = deps(tx);
      const draft = await composeUpdate(d, a.owner, request(a));
      const before = await inWorkspace(tx, a.workspaceId, (s) =>
        s.select().from(schema.outwardDraftVersion),
      );
      await failure(composeUpdate(d, b.owner, request(a)));
      await failure(saveEdit(d, b.owner, { draftId: draft.draftId, body: 'x' }));
      await failure(recordShared(d, b.owner, { draftId: draft.draftId, channel: 'download' }));
      await failure(recordCopied(d, b.owner, { draftId: draft.draftId }));
      const after = await inWorkspace(tx, a.workspaceId, async (s) => ({
        versions: await s.select().from(schema.outwardDraftVersion),
        logs: await s.select().from(schema.outwardShareLog),
      }));
      expect(after.versions).toEqual(before);
      expect(after.logs).toEqual([]);
      const seenByB = await inWorkspace(tx, b.workspaceId, (s) =>
        s.select().from(schema.outwardDraft),
      );
      expect(seenByB).toEqual([]);
    });
  });
});
