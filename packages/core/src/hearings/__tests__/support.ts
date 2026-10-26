// Shared seed for the hearing outcome tests: a matter with a proceeding, the listing the hearing was
// held on, the hearing itself and the voice proposals the job staged for it.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import {
  buildAnchor,
  buildDocument,
  buildForum,
  buildHearing,
  buildListing,
} from '@causedeck/db/testing/matter-graph-fixtures';

import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';
import { createMatter, createProceeding, type GraphEvent } from '../../index.ts';
import type { HearingDeps, HearingEvent } from '../index.ts';

/** 2026-10-21 in Asia/Kolkata. */
export const NOW = new Date('2026-10-21T06:00:00Z');
export const HELD_ON = '2026-10-12';

export interface World {
  workspaceId: string;
  ownerId: string;
  owner: { userId: string; workspaceId: string };
  events: (HearingEvent | GraphEvent)[];
  deps: HearingDeps;
  matterId: string;
  proceedingId: string;
  hearingId: string;
  anchorId: string;
  /** Stage the voice job's drafts for this hearing. */
  stage: (opts?: { nextDate?: string; needsYou?: boolean }) => Promise<Record<string, string>>;
}

export async function world(tx: Transaction): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const events: World['events'] = [];
  const deps: HearingDeps = { db: tx, events: { emit: (e) => events.push(e) }, now: () => NOW };
  const graph = { db: tx, events: { emit: () => undefined }, now: () => NOW };
  const owner = { userId: ownerId, workspaceId };
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const m = await createMatter(graph, owner, { title: 'Fictional v. State' });
  const p = await createProceeding(graph, owner, {
    matterId: m.id,
    forumId: forum.id,
    caseType: 'W.P.',
    number: '101',
    year: 2026,
    provenance: { sourceType: 'manual' },
  });
  const seeded = await inWorkspace(tx, workspaceId, async (s) => {
    const l = await buildListing(s, workspaceId, { proceedingId: p.id, listDate: HELD_ON });
    const h = await buildHearing(s, workspaceId, { listingId: l.id, heldOn: HELD_ON });
    const d = await buildDocument(s, workspaceId, { matterId: m.id, kind: 'note', language: 'en' });
    const a = await buildAnchor(s, workspaceId, { documentId: d.id, kind: 'transcript' });
    return { hearingId: h.id, anchorId: a.id };
  });
  const stage: World['stage'] = async (opts = {}) => {
    const captureId = randomUUID();
    const base = {
      workspaceId,
      captureId,
      level: 'L2' as const,
      matterId: m.id,
      proceedingId: p.id,
      anchors: [seeded.anchorId],
      needsYou: opts.needsYou ?? false,
    };
    const draft = (kind: string, payload: Record<string, unknown>) => ({
      ...base,
      kind,
      payload,
      idempotencyKey: randomUUID(),
    });
    const rows = await inWorkspace(tx, workspaceId, (s) =>
      s
        .insert(schema.proposal)
        .values([
          draft('hearing_outcome', { hearingDate: HELD_ON, outcome: 'Adjourned for arguments' }),
          draft('next_date', { date: opts.nextDate ?? '2026-11-03' }),
          draft('obligation_from_direction', {
            description: 'File counter affidavit',
            dueDate: '2026-10-26',
            matterId: m.id,
          }),
          draft('task', { title: 'Draft rejoinder' }),
        ])
        .returning({ id: schema.proposal.id, kind: schema.proposal.kind }),
    );
    return Object.fromEntries(rows.map((r) => [r.kind, r.id]));
  };
  return {
    workspaceId,
    ownerId,
    owner,
    events,
    deps,
    matterId: m.id,
    proceedingId: p.id,
    ...seeded,
    stage,
  };
}

export { addMember };
