// The server side of the offline push (#65 part 2, #743). A batch of queued edits is applied in
// order, each in its own savepoint so one refusal leaves the others untouched, and each answered
// with a result of its own. Idempotency: every item carries a client key, echoed in its result; a key
// repeated within a batch is answered `duplicate` and not applied again. A replay in a later batch
// is safe because each operation sets an absolute value or is deduplicated by the service (a
// next date proposed twice finds the earlier proposal). A durable cross-batch store is the drain's
// concern (#745). A next date is only ever proposed, never confirmed: if the server's canonical date
// is no longer the one the client saw, the item is a `conflict` carrying the server's value.
import { MarkPreparedInput, SetBriefNoteInput, SetCarryItemInput } from '@causedeck/validators';
import { z } from 'zod';

import { domainErrorCode, graphDeps } from '../../../../../lib/matters/graph-deps.ts';
import type { WorkspaceActionCtx } from '../../../../../lib/workspace-action.ts';

export const MAX_OUTBOX_ITEMS = 50;

const Key = z.string().trim().min(1).max(128);

const NextDateItem = z.strictObject({
  key: Key,
  kind: z.literal('next_date'),
  proceedingId: z.uuid(),
  date: z.iso.date(),
  /** The canonical next date the client last saw; null when it saw none. */
  expectedCanonicalDate: z.iso.date().nullable(),
});
const BriefNoteItem = z.strictObject({
  key: Key,
  kind: z.literal('brief_note'),
  ...SetBriefNoteInput.shape,
});
const BriefPreparedItem = z.strictObject({
  key: Key,
  kind: z.literal('brief_prepared'),
  ...MarkPreparedInput.shape,
  prepared: z.boolean(),
});
const CarryItem = z.strictObject({
  key: Key,
  kind: z.literal('carry_item'),
  carry: SetCarryItemInput,
});

export const OutboxItem = z.discriminatedUnion('kind', [
  NextDateItem,
  BriefNoteItem,
  BriefPreparedItem,
  CarryItem,
]);
export type OutboxItem = z.infer<typeof OutboxItem>;

/** The envelope of a batch: items are checked one by one so a bad one is only its own `rejected`. */
export const OutboxBatch = z.object({
  items: z
    .array(z.looseObject({ key: Key }))
    .min(1)
    .max(MAX_OUTBOX_ITEMS),
});

export type OutboxStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface OutboxResult {
  key: string;
  status: OutboxStatus;
  /** For a refusal: the domain code (`FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, ...). */
  code?: string;
  /** For a next date: what was stored (`proposal`, `noop`, `conflict_card`). */
  outcome?: string;
  /** For a next-date conflict: the server's canonical date now (null when it has none). */
  serverDate?: string | null;
}

type Ctx = Pick<WorkspaceActionCtx, 'tx' | 'workspaceId' | 'userId'>;

async function applyOne(item: OutboxItem, ctx: Ctx): Promise<Omit<OutboxResult, 'key'>> {
  const actor = { workspaceId: ctx.workspaceId, userId: ctx.userId };
  const events = { emit() {} };
  if (item.kind === 'next_date') {
    const graph = await import('@causedeck/core/matter-graph');
    const court = await import('@causedeck/core/court-day');
    const current = await graph.getCanonicalNextDate(graphDeps(ctx.tx), actor, {
      proceedingId: item.proceedingId,
    });
    const serverDate = current?.listDate ?? null;
    if (serverDate !== item.expectedCanonicalDate) return { status: 'conflict', serverDate };
    const result = await court.proposeCourtDayNextDate(graphDeps(ctx.tx), actor, {
      proceedingId: item.proceedingId,
      date: item.date,
      provenance: { sourceType: 'manual' },
    });
    return {
      status: 'applied',
      outcome: result.kind === 'conflict' ? 'conflict_card' : result.kind,
    };
  }
  const briefs = await import('@causedeck/core/briefs');
  const deps = { db: ctx.tx, events };
  if (item.kind === 'brief_note') {
    await briefs.setBriefNote(deps, actor, { listingId: item.listingId, note: item.note });
  } else if (item.kind === 'brief_prepared') {
    const run = item.prepared ? briefs.markPrepared : briefs.unmarkPrepared;
    await run(deps, actor, { listingId: item.listingId });
  } else {
    await briefs.setCarryItem(deps, actor, item.carry);
  }
  return { status: 'applied' };
}

/** Apply a batch in order; never throws for one item's refusal. */
export async function applyOutbox(rawItems: readonly unknown[], ctx: Ctx): Promise<OutboxResult[]> {
  const seen = new Set<string>();
  const results: OutboxResult[] = [];
  for (const raw of rawItems) {
    const key = String((raw as { key?: unknown }).key);
    if (seen.has(key)) {
      results.push({ key, status: 'duplicate' });
      continue;
    }
    seen.add(key);
    const parsed = OutboxItem.safeParse(raw);
    if (!parsed.success) {
      results.push({ key, status: 'rejected', code: 'VALIDATION' });
      continue;
    }
    try {
      // A savepoint: a database error in one item must not abort the others.
      const outcome = await ctx.tx.transaction((sp) => applyOne(parsed.data, { ...ctx, tx: sp }));
      results.push({ key, ...outcome });
    } catch (error) {
      const code = domainErrorCode(error);
      if (code === undefined) throw error;
      results.push({ key, status: code === 'CONFLICT' ? 'conflict' : 'rejected', code });
    }
  }
  return results;
}
