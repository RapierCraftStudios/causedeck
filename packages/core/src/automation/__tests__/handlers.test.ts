// Each handler's round trip (#47): apply, then undo, restores the graph; plus the kinds that are
// registered but switched off. The handlers run inside one engine scope, as the engine runs them.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { confirmNextDate, proposeNextDate, upsertPerson } from '../../index.ts';
import { inAutomationScope } from '../context.ts';
import { KindNotEnabled } from '../errors.ts';
import { handlerFor, HANDLERS } from '../handlers/index.ts';
import type { ActivityRow, HandlerProvenance, HandlerScope } from '../types.ts';

import { world, type World } from './world.ts';

const PROVENANCE: HandlerProvenance = {
  sourceType: 'manual',
  sourceRef: null,
  anchorId: null,
  confidence: null,
  confirmationState: 'confirmed',
};

/** Rows without `updatedAt`, which every write bumps (an undo restores values, not the clock). */
const bare = <T extends object>(list: T[]): Omit<T, 'updatedAt'>[] =>
  list.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    delete copy['updatedAt'];
    return copy as Omit<T, 'updatedAt'>;
  });

/** The graph rows the handlers touch, for before/after comparison. */
async function snapshot(w: World) {
  return inWorkspace(w.tx, w.workspaceId, async (s) => ({
    matters: bare(await s.select().from(schema.matter).orderBy(schema.matter.id)),
    proceedings: bare(await s.select().from(schema.proceeding).orderBy(schema.proceeding.id)),
    listings: bare(await s.select().from(schema.listing).orderBy(schema.listing.id)),
    tasks: bare(await s.select().from(schema.task).orderBy(schema.task.id)),
    obligations: bare(await s.select().from(schema.obligation).orderBy(schema.obligation.id)),
    orders: bare(await s.select().from(schema.order).orderBy(schema.order.id)),
    persons: bare(await s.select().from(schema.person).orderBy(schema.person.id)),
    documents: bare(await s.select().from(schema.document).orderBy(schema.document.id)),
  }));
}

/** Apply `kind` with `payload` and undo it, in one engine scope; returns the apply result. */
async function applyAndUndo(
  w: World,
  kind: Parameters<typeof handlerFor>[0],
  payload: unknown,
  entityRefs: Record<string, unknown> = {},
  between?: (scope: HandlerScope) => Promise<void>,
) {
  return inAutomationScope(w.deps, w.owner, async (scope) => {
    const handler = handlerFor(kind);
    const parsed = handler.validate(payload);
    const result = await handler.apply(scope, {
      payload: parsed,
      provenance: PROVENANCE,
      level: 'L2',
      proposalId: '00000000-0000-4000-8000-0000000000f1',
      entityRefs,
      captureId: null,
    });
    await between?.(scope);
    const activity = {
      workspaceId: w.workspaceId,
      kind,
      undoPayload: result.undoPayload,
      entityRefs: result.entityRefs,
    } as unknown as ActivityRow;
    await handler.undo(scope, activity);
    return result;
  });
}

describe('handler round trips restore the graph', () => {
  it('task', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await snapshot(w);
      await applyAndUndo(w, 'task', { title: 'Call', matterId: w.matterId }, {}, async (scope) => {
        expect(await scope.tx.select().from(schema.task)).toHaveLength(1);
      });
      expect(await snapshot(w)).toEqual(before);
    });
  });

  it('obligation_from_direction', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await snapshot(w);
      await applyAndUndo(w, 'obligation_from_direction', {
        matterId: w.matterId,
        proceedingId: w.proceedingId,
        description: 'File the counter within four weeks',
        dueDate: '2026-12-01',
      });
      expect(await snapshot(w)).toEqual(before);
    });
  });

  it('order_record', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await snapshot(w);
      await applyAndUndo(w, 'order_record', {
        proceedingId: w.proceedingId,
        documentId: w.documentId,
        orderDate: '2026-10-20',
        orderType: 'interim',
      });
      expect(await snapshot(w)).toEqual(before);
    });
  });

  it('new_proceeding', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await snapshot(w);
      await applyAndUndo(w, 'new_proceeding', {
        matterId: w.otherMatterId,
        forumId: w.forumId,
        caseType: 'W.P.',
        number: '7',
        year: 2026,
      });
      expect(await snapshot(w)).toEqual(before);
    });
  });

  it('new_matter: undo archives it', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const result = await applyAndUndo(w, 'new_matter', { title: 'Fictional v. Fictional' });
      const [row] = await inWorkspace(w.tx, w.workspaceId, (s) =>
        s
          .select()
          .from(schema.matter)
          .where(eq(schema.matter.id, String(result.undoPayload['matterId']))),
      );
      expect(row?.status).toBe('archived');
    });
  });

  it('listing_update', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const proposed = await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-11-11',
        provenance: { sourceType: 'manual' },
      });
      if (proposed.kind !== 'proposal') throw new Error('expected a proposal');
      const before = await snapshot(w);
      await applyAndUndo(
        w,
        'listing_update',
        { listingId: proposed.listingId, itemNo: '14' },
        {},
        async (scope) => {
          const [row] = await scope.tx
            .select()
            .from(schema.listing)
            .where(eq(schema.listing.id, proposed.listingId));
          expect(row?.itemNo).toBe('14');
        },
      );
      expect(await snapshot(w)).toEqual(before);
    });
  });

  it('party_detail: a new person, and a contact detail on a known one', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await snapshot(w);
      await applyAndUndo(w, 'party_detail', { name: 'S. Kathir (fictional)', kind: 'client' });
      expect(await snapshot(w)).toEqual(before);

      const known = await upsertPerson(w.deps, w.owner, {
        name: 'P. Ilango (fictional)',
        kind: 'client',
        contact: { email: 'ilango@example.test' },
      });
      const withKnown = await snapshot(w);
      await applyAndUndo(
        w,
        'party_detail',
        { personId: known.id, contact: { phone: '98400 12345' } },
        {},
        async (scope) => {
          const [row] = await scope.tx
            .select()
            .from(schema.person)
            .where(eq(schema.person.id, known.id));
          expect(row?.contact).toEqual({ email: 'ilango@example.test', phone: '98400 12345' });
        },
      );
      expect(await snapshot(w)).toEqual(withKnown);
    });
  });

  it('document_attach and duplicate_merge', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const before = await snapshot(w);
      await applyAndUndo(w, 'document_attach', {
        documentId: w.documentId,
        matterId: w.otherMatterId,
      });
      expect(await snapshot(w)).toEqual(before);
      await applyAndUndo(
        w,
        'duplicate_merge',
        { documentId: w.copyDocumentId, duplicateOfDocumentId: w.documentId },
        {},
        async (scope) => {
          const [row] = await scope.tx
            .select()
            .from(schema.document)
            .where(eq(schema.document.id, w.copyDocumentId));
          expect(row?.supersedesDocumentId).toBe(w.documentId);
        },
      );
      expect(await snapshot(w)).toEqual(before);
    });
  });

  it('next_date: confirm on apply only, and undo returns to the earlier date', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const first = await proposeNextDate(w.deps, w.owner, {
        proceedingId: w.proceedingId,
        date: '2026-11-10',
        provenance: { sourceType: 'manual' },
      });
      if (first.kind !== 'proposal') throw new Error('expected a proposal');
      await confirmNextDate(w.deps, w.owner, { listingId: first.listingId });
      const staged = await inAutomationScope(w.deps, w.owner, async (scope) =>
        handlerFor('next_date').stage?.(
          scope,
          { proceedingId: w.proceedingId, date: '2026-12-15' },
          {
            ...PROVENANCE,
            sourceType: 'adapter',
            sourceRef: 'list',
            confirmationState: 'proposed',
          },
        ),
      );
      expect(staged?.entityRefs).toMatchObject({ conflict: true });
      const before = await snapshot(w);
      await applyAndUndo(
        w,
        'next_date',
        { proceedingId: w.proceedingId, date: '2026-12-15' },
        staged?.entityRefs,
        async (scope) => {
          const canonical = await scope.tx
            .select()
            .from(schema.listing)
            .where(eq(schema.listing.canonical, true));
          expect(canonical.map((l) => l.listDate)).toEqual(['2026-12-15']);
        },
      );
      const after = await snapshot(w);
      expect(after.listings.filter((l) => l.canonical).map((l) => l.listDate)).toEqual([
        '2026-11-10',
      ]);
      expect(after.listings).toHaveLength(before.listings.length);
    });
  });
});

describe('kinds that are registered but not enabled', () => {
  it.each(['memory_item', 'fee_entry', 'outward_draft'] as const)(
    '%s throws KindNotEnabled',
    (kind) => {
      const handler = HANDLERS[kind];
      expect(handler.enabled).toBe(false);
      expect(() => handler.validate({})).toThrow(KindNotEnabled);
    },
  );
});

describe('the registry', () => {
  it('has a validating, applying and undoing handler for every enabled kind', () => {
    for (const [kind, handler] of Object.entries(HANDLERS)) {
      if (!handler.enabled) continue;
      expect(handler.kind, kind).toBe(kind);
      expect(typeof handler.validate, kind).toBe('function');
      expect(typeof handler.apply, kind).toBe('function');
      expect(typeof handler.undo, kind).toBe('function');
    }
  });
});
