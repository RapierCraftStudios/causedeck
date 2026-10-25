// Brief state (#60): the lawyer-authored part of a brief in `brief_state`. `markPrepared` records who
// and when; a later material change clears the mark and emits `brief.stale` with the reason (see
// `detectMaterialChange`, run by the refresh). The writes need `matter.write`; the listing is loaded
// inside the actor's workspace scope, so another workspace's listing is NOT_FOUND and changes nothing.
import { schema } from '@causedeck/db';
import {
  MarkPreparedInput,
  SetBriefNoteInput,
  SetCarryItemInput,
  type BriefState,
} from '@causedeck/validators';

type BriefCarryEntry = BriefState['carry'][number];
import { and, eq, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  inBriefScope,
  loadBriefState,
  loadListing,
  parseBriefInput,
  requireAction,
  type BriefActor,
  type BriefDeps,
  type BriefScope,
  type BriefStaleReason,
} from './assemble.ts';
import { CARRY_REVIEWED_KEY } from './sections/carry.ts';

/** The writer to record: none for the system refresh. */
const updatedBy = (scope: BriefScope): string | null =>
  scope.system === true ? null : scope.actor.userId;

/** Make sure the listing's row exists (one per listing) and return it. */
async function ensureRow(scope: BriefScope, listingId: string) {
  const { tx, actor } = scope;
  await tx
    .insert(schema.briefState)
    .values({ workspaceId: actor.workspaceId, listingId, updatedBy: updatedBy(scope) })
    .onConflictDoNothing({
      target: [schema.briefState.workspaceId, schema.briefState.listingId],
    });
}

async function write(
  scope: BriefScope,
  listingId: string,
  patch: Partial<typeof schema.briefState.$inferInsert>,
): Promise<BriefState> {
  const { tx, actor } = scope;
  await ensureRow(scope, listingId);
  await tx
    .update(schema.briefState)
    .set({ ...patch, updatedBy: updatedBy(scope), updatedAt: scope.now })
    .where(
      and(
        eq(schema.briefState.workspaceId, actor.workspaceId),
        eq(schema.briefState.listingId, listingId),
      ),
    );
  return loadBriefState(scope, listingId);
}

async function inWriteScope<T>(
  deps: BriefDeps,
  actor: BriefActor,
  listingId: string,
  fn: (scope: BriefScope) => Promise<T>,
): Promise<T> {
  return inBriefScope(deps, actor, async (scope) => {
    await requireAction(scope, 'matter.write', 'You cannot change this brief');
    await loadListing(scope, listingId);
    return fn(scope);
  });
}

export async function markPrepared(
  deps: BriefDeps,
  actor: BriefActor,
  input: unknown,
): Promise<BriefState> {
  const { listingId } = parseBriefInput(MarkPreparedInput, input);
  return inWriteScope(deps, actor, listingId, (scope) =>
    write(scope, listingId, { preparedBy: actor.userId, preparedAt: scope.now }),
  );
}

export async function unmarkPrepared(
  deps: BriefDeps,
  actor: BriefActor,
  input: unknown,
): Promise<BriefState> {
  const { listingId } = parseBriefInput(MarkPreparedInput, input);
  return inWriteScope(deps, actor, listingId, (scope) =>
    write(scope, listingId, { preparedBy: null, preparedAt: null }),
  );
}

export async function setBriefNote(
  deps: BriefDeps,
  actor: BriefActor,
  input: unknown,
): Promise<BriefState> {
  const { listingId, note } = parseBriefInput(SetBriefNoteInput, input);
  return inWriteScope(deps, actor, listingId, (scope) =>
    write(scope, listingId, { note: note === null || note === '' ? null : note }),
  );
}

/** Add a manual item, remove one, tick one or mark the list reviewed; edits persist in `brief_state`. */
export async function setCarryItem(
  deps: BriefDeps,
  actor: BriefActor,
  input: unknown,
): Promise<BriefState> {
  const parsed = parseBriefInput(SetCarryItemInput, input);
  return inWriteScope(deps, actor, parsed.listingId, async (scope) => {
    const state = await loadBriefState(scope, parsed.listingId);
    let carry: BriefCarryEntry[] = [...state.carry];
    const find = (key: string) => carry.findIndex((e) => e.key === key);
    switch (parsed.action) {
      case 'add':
        carry.push({
          key: `manual:${randomUUID()}`,
          manual: true,
          label: parsed.label,
          ticked: false,
          removed: false,
        });
        break;
      case 'remove': {
        const at = find(parsed.key);
        if (at >= 0 && carry[at]?.manual) carry.splice(at, 1);
        else if (at >= 0) carry[at] = { ...(carry[at] as BriefCarryEntry), removed: true };
        else
          carry.push({ key: parsed.key, manual: false, label: null, ticked: false, removed: true });
        break;
      }
      case 'tick': {
        const at = find(parsed.key);
        if (at >= 0) carry[at] = { ...(carry[at] as BriefCarryEntry), ticked: parsed.ticked };
        else
          carry.push({
            key: parsed.key,
            manual: false,
            label: null,
            ticked: parsed.ticked,
            removed: false,
          });
        break;
      }
      case 'review': {
        carry = carry.filter((e) => e.key !== CARRY_REVIEWED_KEY);
        carry.push({
          key: CARRY_REVIEWED_KEY,
          manual: false,
          label: null,
          ticked: true,
          removed: false,
        });
        break;
      }
    }
    return write(scope, parsed.listingId, { carry });
  });
}

/**
 * The first material change since the mark was made, or null: a new order, a changed stage (the
 * listing row was updated) or a new obligation on the matter.
 */
export async function detectMaterialChange(
  scope: BriefScope,
  listingId: string,
  preparedAt: Date,
): Promise<BriefStaleReason | null> {
  const { tx, actor } = scope;
  const listing = await loadListing(scope, listingId);
  const [newOrder] = await tx
    .select({ id: schema.order.id })
    .from(schema.order)
    .where(
      and(
        eq(schema.order.workspaceId, actor.workspaceId),
        eq(schema.order.proceedingId, listing.proceedingId),
        gt(schema.order.createdAt, preparedAt),
      ),
    )
    .limit(1);
  if (newOrder !== undefined) return 'new_order';
  if (listing.row.updatedAt.getTime() > preparedAt.getTime()) return 'stage_changed';
  const [newObligation] = await tx
    .select({ id: schema.obligation.id })
    .from(schema.obligation)
    .where(
      and(
        eq(schema.obligation.workspaceId, actor.workspaceId),
        eq(schema.obligation.matterId, listing.matterId),
        gt(schema.obligation.createdAt, preparedAt),
      ),
    )
    .limit(1);
  return newObligation === undefined ? null : 'new_obligation';
}

/**
 * Clear the mark when something material changed since it was made and emit `brief.stale` once; a
 * second call finds no mark and does nothing. Returns the reason, or null.
 */
export async function clearIfStale(
  scope: BriefScope,
  listingId: string,
): Promise<BriefStaleReason | null> {
  const state = await loadBriefState(scope, listingId);
  if (state.prepared_at === null) return null;
  const reason = await detectMaterialChange(scope, listingId, new Date(state.prepared_at));
  if (reason === null) return null;
  await write(scope, listingId, { preparedBy: null, preparedAt: null });
  scope.emit({ type: 'brief.stale', workspaceId: scope.actor.workspaceId, listingId, reason });
  return reason;
}
