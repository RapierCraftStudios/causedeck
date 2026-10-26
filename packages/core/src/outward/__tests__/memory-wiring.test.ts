// Outward drafts use the lawyer's memory (#74): R4 M2 tone and sign-off, M6 client language, each
// use recorded and cited; no memory gives the defaults. R8 paused memory is not used.
import { schema } from '@causedeck/db';
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

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { keys } from '../../__tests__/memory-world.ts';
import { createMemoryNote, setMemoryPauseAll } from '../../memory/index.ts';
import { composeUpdate } from '../index.ts';

const SIGN_OFF = 'Warm regards, Adv. Priya';

async function setup(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const owner = { userId: ownerId, workspaceId };
  const g = await inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const matter = await buildMatter(s, workspaceId);
    const proceeding = await buildProceeding(s, workspaceId, {
      matterId: matter.id,
      forumId: forum.id,
      state: 'sr_fr',
    });
    const listing = await buildListing(s, workspaceId, { proceedingId: proceeding.id });
    const hearing = await buildHearing(s, workspaceId, {
      listingId: listing.id,
      outcome: 'Adjourned',
      nextDateConfirmed: '2026-12-12',
      confirmationState: 'confirmed',
    });
    const client = await buildPerson(s, workspaceId, { kind: 'client' });
    return { matter, hearing, client };
  });
  const memory = { db: tx, keys };
  const request = {
    matterId: g.matter.id,
    hearingId: g.hearing.id,
    audience: 'client',
    clientPersonId: g.client.id,
  };
  const deps = { db: tx, memory };
  const teach = async () => {
    await createMemoryNote(memory, owner, {
      key: 'M2.client_update_tone',
      value: { tone: 'warm', sign_off: SIGN_OFF },
      scope: 'user',
    });
    await createMemoryNote(memory, owner, {
      key: 'M6.client_language',
      value: 'ta',
      scope: 'user',
      personId: g.client.id,
    });
  };
  return { owner, workspaceId, memory, deps, request, teach, tx };
}

describe('outward drafts with memory', () => {
  it('applies M2 tone and sign-off and M6 language, records and cites each use (R4)', async () => {
    await withTestDb(async (tx) => {
      const w = await setup(tx);
      await w.teach();
      const draft = await composeUpdate(w.deps, w.owner, w.request);
      expect(draft.body).toContain(SIGN_OFF);
      expect(draft.memoryCitations).toHaveLength(2);
      const usage = await inWorkspace(tx, w.workspaceId, (s) =>
        s.select().from(schema.memoryUsage),
      );
      expect(usage.filter((u) => u.usedIn === 'draft')).toHaveLength(2);
    });
  });

  it('keeps an explicit tone or language from the request (R4)', async () => {
    await withTestDb(async (tx) => {
      const w = await setup(tx);
      await w.teach();
      const withMemory = await composeUpdate(w.deps, w.owner, w.request);
      const explicit = await composeUpdate(w.deps, w.owner, {
        ...w.request,
        language: 'en',
        tone: 'formal',
      });
      expect(explicit.body).not.toBe(withMemory.body);
    });
  });

  it('with no memory the defaults apply and nothing is cited (R4)', async () => {
    await withTestDb(async (tx) => {
      const w = await setup(tx);
      const plain = await composeUpdate({ db: tx }, w.owner, w.request);
      const empty = await composeUpdate(w.deps, w.owner, w.request);
      expect(empty.body).toBe(plain.body);
      expect(empty.memoryCitations).toEqual([]);
    });
  });

  it('pausing all memory switches the wiring off at once (R8)', async () => {
    await withTestDb(async (tx) => {
      const w = await setup(tx);
      await w.teach();
      await setMemoryPauseAll(w.memory, w.owner, true);
      const draft = await composeUpdate(w.deps, w.owner, w.request);
      expect(draft.body).not.toContain(SIGN_OFF);
      expect(draft.memoryCitations).toEqual([]);
    });
  });
});
