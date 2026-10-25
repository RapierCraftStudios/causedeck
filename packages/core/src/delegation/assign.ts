// Chamber delegation (#63): assign an appearance to a member with a capacity and an optional note,
// move it to someone else (one or all of a departing member's, history intact), take a member off.
// Every change is audited with ids only (never the note); a reassignment records the previous
// assignee. A member who cannot see a restricted matter is refused unless an owner grants access
// explicitly (audited). The assignee gets an in-app notification and nothing leaves the workspace.
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { isRole } from '@causedeck/auth';
import { schema, type Queryable } from '@causedeck/db';
import { notify } from '@causedeck/notifications';
import {
  AssignInput,
  BulkReassignInput,
  ReassignInput,
  UnassignInput,
  type AssignedAppearance,
  type BulkReassignResult,
} from '@causedeck/validators';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { registerReassignProvider, type ReassignProvider } from '../workspaces/index.ts';

import {
  inDelegationScope,
  delegationDay,
  parseDelegationInput,
  requireDelegationAction,
  type DelegationActor,
  type DelegationDeps,
  type DelegationScope,
  type MemberRow,
} from './scope.ts';

const {
  appearance,
  hearing,
  listing,
  matter,
  matterRestriction,
  member,
  organization,
  proceeding,
} = schema;

interface ListingRow {
  listingId: string;
  listDate: string;
  matterId: string;
  matterTitle: string;
  sensitive: boolean;
  caseLabel: string;
  restricted: boolean;
  allowedUserIds: string[];
}

interface Notice {
  userId: string;
  slug: string;
  title: string;
  body: string | undefined;
  key: string;
}

function caseLabel(p: {
  caseTypeCode: string;
  number: string | null;
  year: number | null;
}): string {
  const no = p.number === null ? '' : ` ${p.number}`;
  return `${p.caseTypeCode}${no}${p.year === null ? '' : `/${String(p.year)}`}`;
}

function resourceOf(workspaceId: string, l: ListingRow) {
  return {
    kind: 'listing' as const,
    workspaceId,
    matterId: l.matterId,
    ...(l.restricted ? { restricted: { allowUserIds: l.allowedUserIds } } : {}),
  };
}

const listingSelect = {
  listingId: listing.id,
  listDate: listing.listDate,
  matterId: matter.id,
  matterTitle: matter.title,
  sensitive: matter.sensitive,
  caseTypeCode: proceeding.caseTypeCode,
  number: proceeding.number,
  year: proceeding.year,
  restricted: sql<boolean>`${matterRestriction.id} is not null`,
  allowedUserIds: matterRestriction.allowedUserIds,
};

function toListingRow(r: {
  listingId: string;
  listDate: string;
  matterId: string;
  matterTitle: string;
  sensitive: boolean;
  caseTypeCode: string;
  number: string | null;
  year: number | null;
  restricted: boolean;
  allowedUserIds: string[] | null;
}): ListingRow {
  return {
    listingId: r.listingId,
    listDate: r.listDate,
    matterId: r.matterId,
    matterTitle: r.matterTitle,
    sensitive: r.sensitive,
    caseLabel: caseLabel(r),
    restricted: r.restricted,
    allowedUserIds: r.allowedUserIds ?? [],
  };
}

function listingBase(tx: Queryable) {
  return tx
    .select(listingSelect)
    .from(listing)
    .innerJoin(
      proceeding,
      and(eq(proceeding.workspaceId, listing.workspaceId), eq(proceeding.id, listing.proceedingId)),
    )
    .innerJoin(
      matter,
      and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
    )
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    );
}

async function loadListing(scope: DelegationScope, listingId: string): Promise<ListingRow> {
  const [row] = await listingBase(scope.tx)
    .where(and(eq(listing.workspaceId, scope.actor.workspaceId), eq(listing.id, listingId)))
    .limit(1);
  if (row === undefined) throw notFound('Listing not found');
  return toListingRow(row);
}

/** FORBIDDEN without `appearance.assign`; NOT_FOUND for a matter the actor may not see. */
function requireAssign(scope: DelegationScope, settings: PolicySettings, l: ListingRow): void {
  const decision = can(
    scope.actor,
    'appearance.assign',
    resourceOf(scope.actor.workspaceId, l),
    settings,
  );
  if (decision.allow) return;
  if (decision.reason === 'ROLE_DENIED') throw forbidden('You cannot assign appearances');
  throw notFound('Listing not found');
}

async function actorMember(scope: DelegationScope): Promise<string> {
  const [row] = await scope.tx
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, scope.actor.workspaceId),
        eq(member.userId, scope.actor.userId),
      ),
    )
    .limit(1);
  if (row === undefined) throw notFound('Workspace not found');
  return row.id;
}

async function activeAssignee(scope: DelegationScope, memberId: string): Promise<MemberRow> {
  const [row] = await scope.tx
    .select({ id: member.id, userId: member.userId, role: member.role, status: member.status })
    .from(member)
    .where(and(eq(member.organizationId, scope.actor.workspaceId), eq(member.id, memberId)))
    .limit(1);
  if (row === undefined || row.status !== 'active') throw notFound('Member not found');
  return row;
}

/**
 * Whether the assignee may see the matter. A member who cannot is refused, except that an owner may
 * pass `grantAccess`, which lists the member on the matter's restriction and is audited. Returns
 * true when access was granted now.
 */
async function ensureAccess(
  scope: DelegationScope,
  settings: PolicySettings,
  l: ListingRow,
  assignee: MemberRow,
  grantAccess: boolean | undefined,
): Promise<boolean> {
  if (!isRole(assignee.role)) throw notFound('Member not found');
  const { workspaceId } = scope.actor;
  // Holding an appearance on the matter is what puts a junior on it, so only a restriction can block.
  const asAssignee: Actor = {
    userId: assignee.userId,
    workspaceId,
    role: assignee.role,
    assignedMatterIds: new Set([l.matterId]),
  };
  if (can(asAssignee, 'listing.read', resourceOf(workspaceId, l), settings).allow) return false;
  if (grantAccess !== true) {
    throw forbidden(
      'This member cannot see this restricted matter. An owner can grant access explicitly.',
    );
  }
  if (scope.actor.role !== 'owner')
    throw forbidden('Only an owner can grant access to a restricted matter');
  await scope.tx
    .update(matterRestriction)
    .set({
      allowedUserIds: sql`array_append(${matterRestriction.allowedUserIds}, ${assignee.userId}::uuid)`,
    })
    .where(
      and(
        eq(matterRestriction.workspaceId, workspaceId),
        eq(matterRestriction.matterId, l.matterId),
      ),
    );
  await record(
    { db: scope.tx, workspaceId, actor: { userId: scope.actor.userId, kind: 'user' } },
    {
      action: 'matter.access_granted',
      target: { kind: 'matter', id: l.matterId },
      metadata: { memberId: assignee.id, listingId: l.listingId },
    },
  );
  l.allowedUserIds = [...l.allowedUserIds, assignee.userId];
  return true;
}

async function hearingFor(scope: DelegationScope, l: ListingRow): Promise<string> {
  const { workspaceId } = scope.actor;
  const [existing] = await scope.tx
    .select({ id: hearing.id })
    .from(hearing)
    .where(and(eq(hearing.workspaceId, workspaceId), eq(hearing.listingId, l.listingId)))
    .orderBy(asc(hearing.createdAt), asc(hearing.id))
    .limit(1);
  if (existing !== undefined) return existing.id;
  const [created] = await scope.tx
    .insert(hearing)
    .values({ workspaceId, listingId: l.listingId, heldOn: l.listDate, sourceType: 'manual' })
    .returning({ id: hearing.id });
  if (created === undefined) throw new Error('assignAppearance: hearing insert returned no row');
  return created.id;
}

async function noticeFor(
  scope: DelegationScope,
  assignee: MemberRow,
  l: ListingRow,
  key: string,
  count = 1,
): Promise<Notice> {
  const [org] = await scope.tx
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, scope.actor.workspaceId))
    .limit(1);
  // A sensitive matter is never named in a notification.
  const body = count > 1 ? undefined : l.sensitive ? undefined : `${l.caseLabel} on ${l.listDate}`;
  return {
    userId: assignee.userId,
    slug: org?.slug ?? '',
    title:
      count > 1
        ? `${String(count)} appearances were assigned to you`
        : 'An appearance was assigned to you',
    body,
    key,
  };
}

/** Send after the scope has committed; a failed notification never undoes the assignment. */
async function send(deps: DelegationDeps, workspaceId: string, notice: Notice): Promise<void> {
  try {
    await notify(
      {
        db: deps.db,
        workspaceId,
        enqueueDelivery: deps.enqueueDelivery ?? (() => Promise.resolve()),
      },
      {
        userId: notice.userId,
        category: 'system.notice',
        title: notice.title,
        ...(notice.body === undefined ? {} : { body: notice.body }),
        href: `/w/${notice.slug}/tomorrow/plan`,
        dedupeKey: notice.key,
      },
    );
  } catch {
    // The appearance stays assigned; the assignee sees it on their own day.
  }
}

/** Assign `memberId` to a listed item. Needs `appearance.assign`. */
export async function assignAppearance(
  deps: DelegationDeps,
  actor: DelegationActor,
  input: AssignInput,
): Promise<AssignedAppearance> {
  const data = parseDelegationInput(AssignInput, input);
  const out = await inDelegationScope(deps, actor, async (scope) => {
    const { workspaceId, userId } = scope.actor;
    const settings = await scope.settings();
    const l = await loadListing(scope, data.listingId);
    requireAssign(scope, settings, l);
    const assignee = await activeAssignee(scope, data.memberId);
    const accessGranted = await ensureAccess(scope, settings, l, assignee, data.grantAccess);
    const hearingId = await hearingFor(scope, l);
    const by = await actorMember(scope);
    const note = data.note === undefined || data.note === '' ? null : data.note;
    const [held] = await scope.tx
      .select({ id: appearance.id })
      .from(appearance)
      .where(
        and(
          eq(appearance.workspaceId, workspaceId),
          eq(appearance.hearingId, hearingId),
          eq(appearance.memberId, assignee.id),
        ),
      )
      .limit(1);
    const values = { capacity: data.capacity, note, assignedByMemberId: by };
    const [row] =
      held === undefined
        ? await scope.tx
            .insert(appearance)
            .values({ workspaceId, hearingId, memberId: assignee.id, ...values })
            .returning()
        : await scope.tx
            .update(appearance)
            .set(values)
            .where(and(eq(appearance.workspaceId, workspaceId), eq(appearance.id, held.id)))
            .returning();
    if (row === undefined) throw new Error('assignAppearance: write returned no row');
    await record(
      { db: scope.tx, workspaceId, actor: { userId, kind: 'user' } },
      {
        action: 'appearance.assigned',
        target: { kind: 'appearance', id: row.id },
        metadata: {
          listingId: l.listingId,
          memberId: assignee.id,
          capacity: data.capacity,
          accessGranted,
        },
      },
    );
    const notice = await noticeFor(
      scope,
      assignee,
      l,
      `appearance:${row.id}:${assignee.id}:${String(Date.now())}`,
    );
    const result: AssignedAppearance = {
      appearanceId: row.id,
      listingId: l.listingId,
      memberId: assignee.id,
      capacity: row.capacity,
      note: row.note,
      previousMemberId: null,
      accessGranted,
    };
    return { result, notice };
  });
  await send(deps, actor.workspaceId, out.notice);
  return out.result;
}

interface HeldAppearance {
  id: string;
  memberId: string | null;
  capacity: typeof appearance.$inferSelect.capacity;
  note: string | null;
  listing: ListingRow;
}

async function loadAppearance(
  scope: DelegationScope,
  appearanceId: string,
): Promise<HeldAppearance> {
  const [row] = await scope.tx
    .select({
      id: appearance.id,
      memberId: appearance.memberId,
      capacity: appearance.capacity,
      note: appearance.note,
      ...listingSelect,
    })
    .from(appearance)
    .innerJoin(
      hearing,
      and(eq(hearing.workspaceId, appearance.workspaceId), eq(hearing.id, appearance.hearingId)),
    )
    .innerJoin(
      listing,
      and(eq(listing.workspaceId, hearing.workspaceId), eq(listing.id, hearing.listingId)),
    )
    .innerJoin(
      proceeding,
      and(eq(proceeding.workspaceId, listing.workspaceId), eq(proceeding.id, listing.proceedingId)),
    )
    .innerJoin(
      matter,
      and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
    )
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    )
    .where(
      and(eq(appearance.workspaceId, scope.actor.workspaceId), eq(appearance.id, appearanceId)),
    )
    .limit(1);
  if (row === undefined) throw notFound('Appearance not found');
  return {
    id: row.id,
    memberId: row.memberId,
    capacity: row.capacity,
    note: row.note,
    listing: toListingRow(row),
  };
}

/** The appearance ids of a member on or after a day, with their matters (the actor's view). */
async function futureAppearances(
  tx: Queryable,
  workspaceId: string,
  memberId: string,
  from: string,
) {
  return tx
    .select({
      id: appearance.id,
      capacity: appearance.capacity,
      ...listingSelect,
    })
    .from(appearance)
    .innerJoin(
      hearing,
      and(eq(hearing.workspaceId, appearance.workspaceId), eq(hearing.id, appearance.hearingId)),
    )
    .innerJoin(
      listing,
      and(eq(listing.workspaceId, hearing.workspaceId), eq(listing.id, hearing.listingId)),
    )
    .innerJoin(
      proceeding,
      and(eq(proceeding.workspaceId, listing.workspaceId), eq(proceeding.id, listing.proceedingId)),
    )
    .innerJoin(
      matter,
      and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
    )
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    )
    .where(
      and(
        eq(appearance.workspaceId, workspaceId),
        eq(appearance.memberId, memberId),
        gte(listing.listDate, from),
      ),
    )
    .orderBy(asc(listing.listDate), asc(appearance.id));
}

async function reassignOne(
  deps: DelegationDeps,
  actor: DelegationActor,
  data: ReassignInput,
): Promise<AssignedAppearance> {
  const out = await inDelegationScope(deps, actor, async (scope) => {
    const { workspaceId, userId } = scope.actor;
    const settings = await scope.settings();
    const held = await loadAppearance(scope, data.appearanceId);
    requireAssign(scope, settings, held.listing);
    if (held.memberId === null) throw invalid('This appearance is not held by a member');
    if (held.memberId === data.toMemberId) throw invalid('Choose a different member');
    const assignee = await activeAssignee(scope, data.toMemberId);
    const accessGranted = await ensureAccess(
      scope,
      settings,
      held.listing,
      assignee,
      data.grantAccess,
    );
    const by = await actorMember(scope);
    const capacity = data.capacity ?? held.capacity;
    const note = data.note === undefined ? held.note : data.note === '' ? null : data.note;
    await scope.tx
      .update(appearance)
      .set({ memberId: assignee.id, capacity, note, assignedByMemberId: by })
      .where(and(eq(appearance.workspaceId, workspaceId), eq(appearance.id, held.id)));
    await record(
      { db: scope.tx, workspaceId, actor: { userId, kind: 'user' } },
      {
        action: 'appearance.reassigned',
        target: { kind: 'appearance', id: held.id },
        metadata: {
          listingId: held.listing.listingId,
          previousMemberId: held.memberId,
          memberId: assignee.id,
          capacity,
          accessGranted,
        },
      },
    );
    const notice = await noticeFor(
      scope,
      assignee,
      held.listing,
      `appearance:${held.id}:${assignee.id}:${String(Date.now())}`,
    );
    const result: AssignedAppearance = {
      appearanceId: held.id,
      listingId: held.listing.listingId,
      memberId: assignee.id,
      capacity,
      note,
      previousMemberId: held.memberId,
      accessGranted,
    };
    return { result, notice };
  });
  await send(deps, actor.workspaceId, out.notice);
  return out.result;
}

async function reassignMany(
  deps: DelegationDeps,
  actor: DelegationActor,
  data: BulkReassignInput,
): Promise<BulkReassignResult> {
  const now = (deps.now ?? (() => new Date()))();
  const out = await inDelegationScope(deps, actor, async (scope) => {
    const { workspaceId, userId } = scope.actor;
    const settings = await scope.settings();
    requireDelegationAction(scope, 'appearance.assign', settings, 'You cannot assign appearances');
    if (data.fromMemberId === data.toMemberId) throw invalid('Choose a different member');
    const from = data.fromDate ?? delegationDay(now);
    const target = await activeAssignee(scope, data.toMemberId);
    const rows = (await futureAppearances(scope.tx, workspaceId, data.fromMemberId, from)).map(
      (r) => ({
        id: r.id,
        capacity: r.capacity,
        listing: toListingRow(r),
      }),
    );
    // Appearances on matters the actor may not see stay where they are.
    const mine = rows.filter(
      (r) =>
        can(scope.actor, 'appearance.assign', resourceOf(workspaceId, r.listing), settings).allow,
    );
    if (mine.length === 0) return undefined;
    const by = await actorMember(scope);
    const grantedMatters = new Set<string>();
    for (const r of mine) {
      if (grantedMatters.has(r.listing.matterId)) continue;
      if (await ensureAccess(scope, settings, r.listing, target, data.grantAccess)) {
        grantedMatters.add(r.listing.matterId);
      }
    }
    const ids = mine.map((r) => r.id);
    await scope.tx
      .update(appearance)
      .set({ memberId: target.id, assignedByMemberId: by })
      .where(and(eq(appearance.workspaceId, workspaceId), inArray(appearance.id, ids)));
    for (const r of mine) {
      await record(
        { db: scope.tx, workspaceId, actor: { userId, kind: 'user' } },
        {
          action: 'appearance.reassigned',
          target: { kind: 'appearance', id: r.id },
          metadata: {
            listingId: r.listing.listingId,
            previousMemberId: data.fromMemberId,
            memberId: target.id,
            capacity: r.capacity,
            accessGranted: grantedMatters.has(r.listing.matterId),
            bulk: true,
          },
        },
      );
    }
    const first = mine[0];
    if (first === undefined) return undefined;
    const notice = await noticeFor(
      scope,
      target,
      first.listing,
      `appearances:${target.id}:${String(Date.now())}`,
      ids.length,
    );
    return { result: { moved: ids.length, appearanceIds: ids }, notice };
  });
  if (out === undefined) return { moved: 0, appearanceIds: [] };
  await send(deps, actor.workspaceId, out.notice);
  return out.result;
}

/**
 * Move an appearance to another member (`ReassignInput`, the previous assignee goes to the audit
 * event), or every appearance of a departing member on or after `fromDate` (`BulkReassignInput`,
 * earlier ones stay so history is intact). Needs `appearance.assign`.
 */
export function reassignAppearance(
  deps: DelegationDeps,
  actor: DelegationActor,
  input: ReassignInput,
): Promise<AssignedAppearance>;
export function reassignAppearance(
  deps: DelegationDeps,
  actor: DelegationActor,
  input: BulkReassignInput,
): Promise<BulkReassignResult>;
export function reassignAppearance(
  deps: DelegationDeps,
  actor: DelegationActor,
  input: ReassignInput | BulkReassignInput,
): Promise<AssignedAppearance | BulkReassignResult> {
  if (typeof input === 'object' && 'fromMemberId' in input) {
    return reassignMany(deps, actor, parseDelegationInput(BulkReassignInput, input));
  }
  return reassignOne(deps, actor, parseDelegationInput(ReassignInput, input));
}

/** Take the member off an appearance (the row goes; the audit event keeps who held it). */
export async function unassign(
  deps: DelegationDeps,
  actor: DelegationActor,
  input: UnassignInput,
): Promise<boolean> {
  const data = parseDelegationInput(UnassignInput, input);
  return inDelegationScope(deps, actor, async (scope) => {
    const { workspaceId, userId } = scope.actor;
    const settings = await scope.settings();
    const held = await loadAppearance(scope, data.appearanceId);
    requireAssign(scope, settings, held.listing);
    if (held.memberId === null) throw invalid('This appearance is not held by a member');
    await scope.tx
      .delete(appearance)
      .where(and(eq(appearance.workspaceId, workspaceId), eq(appearance.id, held.id)));
    await record(
      { db: scope.tx, workspaceId, actor: { userId, kind: 'user' } },
      {
        action: 'appearance.unassigned',
        target: { kind: 'appearance', id: held.id },
        metadata: { listingId: held.listing.listingId, previousMemberId: held.memberId },
      },
    );
    return true;
  });
}

async function memberOfUser(
  tx: Queryable,
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Offboarding (#18): a departing member's upcoming appearances (today on) count as open work and
 * move to the member who takes over; earlier ones stay with them. Registered with
 * `registerReassignProvider`, so `removeMember` asks for a successor when there are any.
 */
export const appearanceReassignProvider: ReassignProvider = {
  name: 'appearances',
  async countOpen(tx, workspaceId, userId) {
    const memberId = await memberOfUser(tx, workspaceId, userId);
    if (memberId === null) return 0;
    return (await futureAppearances(tx, workspaceId, memberId, delegationDay(new Date()))).length;
  },
  async reassign(tx, workspaceId, fromUserId, toUserId) {
    const from = await memberOfUser(tx, workspaceId, fromUserId);
    const to = await memberOfUser(tx, workspaceId, toUserId);
    if (from === null || to === null) return;
    const rows = await futureAppearances(tx, workspaceId, from, delegationDay(new Date()));
    if (rows.length === 0) return;
    await tx
      .update(appearance)
      .set({ memberId: to, assignedByMemberId: from })
      .where(
        and(
          eq(appearance.workspaceId, workspaceId),
          inArray(
            appearance.id,
            rows.map((r) => r.id),
          ),
        ),
      );
    for (const r of rows) {
      await record(
        { db: tx, workspaceId, actor: { userId: null, kind: 'system' } },
        {
          action: 'appearance.reassigned',
          target: { kind: 'appearance', id: r.id },
          metadata: {
            listingId: r.listingId,
            previousMemberId: from,
            memberId: to,
            capacity: r.capacity,
            offboarding: true,
          },
        },
      );
    }
  },
};

let registered = false;

/** Register the provider once; the barrel does so on load. */
export function registerAppearanceReassignProvider(): void {
  if (registered) return;
  registered = true;
  registerReassignProvider(appearanceReassignProvider);
}
