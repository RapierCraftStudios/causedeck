// A workspace with a matter, a proceeding and two documents for the automation tests (#47), plus
// the deps the engine takes. The clock is fixed so the 7-day window can be moved by the test.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import {
  createDocument,
  createMatter,
  createProceeding,
  type GraphEvent,
  type MatterGraphDeps,
} from '../../index.ts';

export const NOW = new Date('2026-10-21T06:00:00Z');
export const ANCHOR_NONE: string[] = [];

export interface World {
  tx: Transaction;
  workspaceId: string;
  ownerId: string;
  owner: { userId: string; workspaceId: string };
  events: GraphEvent[];
  deps: MatterGraphDeps;
  clock: { now: Date };
  forumId: string;
  matterId: string;
  otherMatterId: string;
  proceedingId: string;
  documentId: string;
  /** A second document on the first matter, for duplicate tests. */
  copyDocumentId: string;
}

export async function world(tx: Transaction): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const clock = { now: NOW };
  const events: GraphEvent[] = [];
  const deps: MatterGraphDeps = {
    db: tx,
    events: { emit: (e) => events.push(e) },
    now: () => clock.now,
  };
  const owner = { userId: ownerId, workspaceId };
  const matter = await createMatter(deps, owner, { title: 'Ilango v. State (fictional)' });
  const other = await createMatter(deps, owner, { title: 'Mullai Traders v. Revenue (fictional)' });
  const proceeding = await createProceeding(deps, owner, {
    matterId: matter.id,
    forumId: forum.id,
    caseType: 'W.P.',
    number: '101',
    year: 2026,
    provenance: { sourceType: 'manual' },
  });
  const doc = (name: string, matterId: string) =>
    createDocument(deps, owner, {
      matterId,
      kind: 'note',
      storageKey: `ws/${workspaceId}/${name}-${randomUUID()}.txt`,
      sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    });
  const document = await doc('a', matter.id);
  const copy = await doc('b', matter.id);
  events.length = 0;
  return {
    tx,
    workspaceId,
    ownerId,
    owner,
    events,
    deps,
    clock,
    forumId: forum.id,
    matterId: matter.id,
    otherMatterId: other.id,
    proceedingId: proceeding.id,
    documentId: document.id,
    copyDocumentId: copy.id,
  };
}

/** A deterministic, anchored draft; `kind`, `payload` and the rest of the draft are the test's. */
export function draft(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    source: { type: 'deterministic', input: 'document' },
    anchors: [],
    confidence: 0.95,
    ...fields,
  };
}

export const rows = {
  document: (w: World, id: string) =>
    inWorkspace(w.tx, w.workspaceId, async (s) => {
      const [row] = await s.select().from(schema.document).where(eq(schema.document.id, id));
      return row;
    }),
  proposals: (w: World) =>
    inWorkspace(w.tx, w.workspaceId, (s) =>
      s.select().from(schema.proposal).orderBy(schema.proposal.createdAt, schema.proposal.id),
    ),
  activities: (w: World) =>
    inWorkspace(w.tx, w.workspaceId, (s) =>
      s.select().from(schema.activity).orderBy(schema.activity.createdAt, schema.activity.id),
    ),
  tasks: (w: World) =>
    inWorkspace(w.tx, w.workspaceId, (s) => s.select().from(schema.task).orderBy(schema.task.id)),
  thresholds: (w: World) =>
    inWorkspace(w.tx, w.workspaceId, (s) => s.select().from(schema.automationThreshold)),
  audit: (w: World, action: string) =>
    inWorkspace(w.tx, w.workspaceId, (s) =>
      s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, action)),
    ),
};
