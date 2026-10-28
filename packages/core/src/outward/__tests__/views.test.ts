// The outward-draft read model (#736): the ready list, one draft with system and latest text,
// the role gate and tenant isolation.
import type { Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildForum,
  buildHearing,
  buildListing,
  buildMatter,
  buildPerson,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { describe, expect, it } from 'vitest';

import { addMember, failure, newWorkspace } from '../../__tests__/fixtures.ts';
import { composeUpdate, getDraft, listDrafts, recordShared, saveEdit } from '../index.ts';

let tick = 0;
const deps = (tx: Transaction) => ({
  db: tx,
  now: () => new Date(Date.UTC(2026, 10, 10, 6, 0, tick++)),
});

// A sensitive matter makes the draft template-only: no model call is needed.
async function world(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const owner = { userId: ownerId, workspaceId };
  const g = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const matter = await buildMatter(s, workspaceId, { sensitive: true });
    const proceeding = await buildProceeding(s, workspaceId, {
      matterId: matter.id,
      forumId: forum.id,
      state: 'sr_fr',
    });
    const listing = await buildListing(s, workspaceId, { proceedingId: proceeding.id });
    const hearing = await buildHearing(s, workspaceId, {
      listingId: listing.id,
      outcome: 'Adjourned for arguments',
      nextDateConfirmed: '2026-12-12',
      confirmationState: 'confirmed',
    });
    const client = await buildPerson(s, workspaceId, { kind: 'client' });
    return { matter, hearing, client };
  });
  const compose = () =>
    composeUpdate(deps(tx), owner, {
      matterId: g.matter.id,
      hearingId: g.hearing.id,
      audience: 'client',
      clientPersonId: g.client.id,
    });
  return { workspaceId, owner, compose, ...g };
}

describe('outward draft read model', () => {
  it('lists a prepared draft and keeps the system text apart from the lawyer text', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const draft = await w.compose();
      const [listed] = await listDrafts(deps(tx), w.owner);
      expect(listed).toMatchObject({
        id: draft.draftId,
        matterId: w.matter.id,
        audience: 'client',
        language: 'en',
        status: 'drafted',
      });
      expect(listed?.preview).toBe(draft.body.slice(0, 240));

      await saveEdit(deps(tx), w.owner, { draftId: draft.draftId, body: 'My own words.' });
      const detail = await getDraft(deps(tx), w.owner, draft.draftId);
      expect(detail.status).toBe('edited');
      expect(detail.body).toBe('My own words.');
      expect(detail.systemBody).toBe(draft.body);
      expect(detail.facts.length).toBeGreaterThan(0);
      expect(detail.versions.map((v) => v.author)).toEqual(['system', 'member']);
    });
  });

  it('newest first, and a shared draft leaves the ready list', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const first = await w.compose();
      const second = await w.compose();
      expect((await listDrafts(deps(tx), w.owner)).map((d) => d.id)).toEqual([
        second.draftId,
        first.draftId,
      ]);
      await recordShared(deps(tx), w.owner, { draftId: second.draftId, channel: 'download' });
      expect((await listDrafts(deps(tx), w.owner)).map((d) => d.id)).toEqual([first.draftId]);
    });
  });

  it('denies a clerk and hides another workspace', async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      const draft = await a.compose();
      const clerk = await addMember(tx, a.workspaceId, 'clerk');
      const clerkActor = { userId: clerk, workspaceId: a.workspaceId };
      expect(await failure(listDrafts(deps(tx), clerkActor))).toMatchObject({ code: 'FORBIDDEN' });
      expect(await failure(getDraft(deps(tx), clerkActor, draft.draftId))).toMatchObject({
        code: 'FORBIDDEN',
      });
      const b = await world(tx);
      expect(await listDrafts(deps(tx), b.owner)).toEqual([]);
      expect(await failure(getDraft(deps(tx), b.owner, draft.draftId))).toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
