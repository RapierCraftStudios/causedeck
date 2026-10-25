// The read models of the obligation surface (#68): the hydrated queue, the defects and copies
// lists and the filter options, on the test database.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum, buildMatter, buildProceeding } from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import {
  applyForCertifiedCopy,
  caseNumberOf,
  createObligation,
  listCertifiedCopies,
  listDefects,
  obligationOptions,
  queryQueueView,
  raiseDefect,
} from '../index.ts';

const NOW = new Date('2026-11-10T06:00:00Z');
const deps = (tx: Transaction) => ({ db: tx, now: () => NOW });
const manual = { sourceType: 'manual' as const };

async function world(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const [self] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, workspaceId), eq(schema.member.userId, ownerId))),
  );
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const matter = await inWorkspace(tx, workspaceId, (s) => buildMatter(s, workspaceId));
  const proceeding = await inWorkspace(tx, workspaceId, (s) =>
    buildProceeding(s, workspaceId, {
      matterId: matter.id,
      forumId: forum.id,
      state: 'sr_fr',
      number: '1234',
      year: 2026,
    }),
  );
  return {
    owner: { userId: ownerId, workspaceId },
    memberId: String(self?.id),
    matter,
    proceedingId: proceeding.id,
  };
}

describe('obligation read models (#68)', () => {
  it('hydrates the queue rows with the matter title, owner name and case number', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const row = await createObligation(deps(tx), w.owner, {
        matterId: w.matter.id,
        proceedingId: w.proceedingId,
        source: 'internal',
        description: 'Call the registry',
        dueDate: '2026-11-05',
        ownerMemberId: w.memberId,
        provenance: manual,
      });
      const view = await queryQueueView(deps(tx), w.owner);
      const found = view.overdue.find((o) => o.id === row.id);
      expect(found?.matterTitle).toBe(w.matter.title);
      expect(found?.ownerName).toEqual(expect.any(String));
      expect(found?.caseNumber).toMatch(/1234\/2026$/);
      expect(found?.sourceQuote).toBeNull();
    });
  });

  it('lists defects with cure-by dates and the proceeding state, and copies with their step', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await raiseDefect(deps(tx), w.owner, {
        proceedingId: w.proceedingId,
        description: 'Court fee short',
        raisedOn: '2026-11-10',
        cureBy: '2026-11-17',
        ownerMemberId: w.memberId,
        provenance: manual,
      });
      const copy = await applyForCertifiedCopy(deps(tx), w.owner, {
        matterId: w.matter.id,
        proceedingId: w.proceedingId,
        description: 'Certified copy of the order',
        appliedOn: '2026-11-10',
        followUpOn: '2026-11-12',
        ownerMemberId: w.memberId,
        provenance: manual,
      });
      const defects = await listDefects(deps(tx), w.owner);
      expect(defects).toHaveLength(1);
      expect(defects[0]).toMatchObject({
        cureBy: '2026-11-17',
        curedOn: null,
        proceedingState: 'defects',
      });
      const copies = await listCertifiedCopies(deps(tx), w.owner);
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({ id: copy.id, status: 'applied', nextDue: '2026-11-12' });
      const options = await obligationOptions(deps(tx), w.owner);
      expect(options.matters.map((m) => m.id)).toContain(w.matter.id);
      expect(options.members.map((m) => m.id)).toContain(w.memberId);
    });
  });

  it('writes the case number only once the proceeding has one', () => {
    expect(caseNumberOf({ caseTypeCode: 'WP', number: '7', year: 2026 })).toBe('WP 7/2026');
    expect(caseNumberOf({ caseTypeCode: 'WP', number: null, year: null })).toBeNull();
  });
});
