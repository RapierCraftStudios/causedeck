// Assignment suggestions (#63): proposals for tomorrow's plan, never writes (L2: the owner accepts
// each one). An item nobody is on gets the member who has appeared on that matter before, else the
// least loaded; a hall or complex clash (court-day `detectClashes`) moves one of its two items to a
// different member who is free of a clash. Each suggestion carries a one-line reason that names halls
// and members, never a matter.
import { isRole } from '@causedeck/auth';
import { can, type Actor } from '@causedeck/auth/policy';
import { schema } from '@causedeck/db';
import {
  SuggestInput,
  type CourtDayItem,
  type Suggestion,
  type SuggestionList,
} from '@causedeck/validators';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';

import { detectClashes, getCourtDay, type ClashCandidate } from '../court-day/index.ts';

import {
  inDelegationScope,
  parseDelegationInput,
  requireAction,
  type DelegationActor,
  type DelegationDeps,
} from './scope.ts';

const { appearance, hearing, listing, matterRestriction, member, proceeding, user } = schema;

type Capacity = Suggestion['capacity'];

interface Candidate {
  memberId: string;
  userId: string;
  name: string;
  actor: Actor;
}

interface Placed {
  item: CourtDayItem;
  forumId: string;
}

/** Roles that appear in court and so can be proposed. */
const APPEARS = new Set(['owner', 'advocate', 'junior']);

const hallOf = (item: CourtDayItem): string =>
  item.hallNo === null ? 'an unplaced hall' : `Hall ${item.hallNo}`;

/**
 * Proposals for `date`: unassigned items and clashes, each with a different member and a reason.
 * Needs `appearance.assign` and `court_day.view_all`. Writes nothing.
 */
export async function suggestAssignments(
  deps: DelegationDeps,
  actor: DelegationActor,
  input: SuggestInput,
): Promise<SuggestionList> {
  const { date } = parseDelegationInput(SuggestInput, input);
  return inDelegationScope(deps, actor, async (scope) => {
    const { workspaceId } = scope.actor;
    const settings = await scope.settings();
    requireAction(scope, 'appearance.assign', settings, 'You cannot assign appearances');
    const day = await getCourtDay(
      { db: scope.tx, settings },
      { workspaceId, userId: scope.actor.userId },
      { date, scope: 'workspace' },
    );
    const placed: Placed[] = day.complexes.flatMap((c) =>
      c.halls.flatMap((h) =>
        h.lists.flatMap((l) => l.items.map((item) => ({ item, forumId: c.forumId }))),
      ),
    );
    if (placed.length === 0) return { date, suggestions: [] };

    const matterIds = [...new Set(placed.map((p) => p.item.matterId))];
    const members = await scope.tx
      .select({ id: member.id, userId: member.userId, role: member.role, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, workspaceId), eq(member.status, 'active')));
    const nameOf = new Map(members.map((m) => [m.id, m.name]));
    const restrictions = await scope.tx
      .select({ matterId: matterRestriction.matterId, allowed: matterRestriction.allowedUserIds })
      .from(matterRestriction)
      .where(
        and(
          eq(matterRestriction.workspaceId, workspaceId),
          inArray(matterRestriction.matterId, matterIds),
        ),
      );
    const allowedOn = new Map(restrictions.map((r) => [r.matterId, r.allowed]));
    const candidates: Candidate[] = members.flatMap((m) =>
      APPEARS.has(m.role) && isRole(m.role)
        ? [
            {
              memberId: m.id,
              userId: m.userId,
              name: m.name,
              actor: { userId: m.userId, workspaceId, role: m.role },
            },
          ]
        : [],
    );

    // Past assignment pattern: who has appeared on each matter before, and in what capacity.
    const past = await scope.tx
      .select({
        matterId: proceeding.matterId,
        memberId: appearance.memberId,
        capacity: appearance.capacity,
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
        and(
          eq(proceeding.workspaceId, listing.workspaceId),
          eq(proceeding.id, listing.proceedingId),
        ),
      )
      .where(
        and(
          eq(appearance.workspaceId, workspaceId),
          inArray(proceeding.matterId, matterIds),
          lt(listing.listDate, date),
        ),
      )
      .orderBy(desc(listing.listDate), desc(appearance.id));
    const history = new Map<string, Map<string, { count: number; capacity: Capacity }>>();
    for (const p of past) {
      if (p.memberId === null) continue;
      const byMember = history.get(p.matterId) ?? new Map();
      const seen = byMember.get(p.memberId);
      byMember.set(p.memberId, { count: (seen?.count ?? 0) + 1, capacity: seen?.capacity ?? p.capacity });
      history.set(p.matterId, byMember);
    }

    // The day's load and placements per member; proposals count as they are made.
    const load = new Map<string, number>();
    const spots = new Map<string, Placed[]>();
    const take = (memberId: string, p: Placed): void => {
      load.set(memberId, (load.get(memberId) ?? 0) + 1);
      spots.set(memberId, [...(spots.get(memberId) ?? []), p]);
    };
    for (const p of placed) for (const id of p.item.appearingMemberIds) take(id, p);

    const free = (c: Candidate, target: Placed): boolean =>
      (spots.get(c.memberId) ?? []).every(
        (o) =>
          o.item.proceedingId === target.item.proceedingId ||
          (o.forumId === target.forumId &&
            (o.item.hallId === null ||
              target.item.hallId === null ||
              o.item.hallId === target.item.hallId)),
      );
    const pick = (target: Placed, exclude: ReadonlySet<string>): Candidate | undefined => {
      const { item } = target;
      const readable = candidates.filter((c) => {
        if (exclude.has(c.memberId) || item.appearingMemberIds.includes(c.memberId)) return false;
        const allowed = allowedOn.get(item.matterId);
        return can(
          { ...c.actor, assignedMatterIds: new Set([item.matterId]) },
          'listing.read',
          {
            kind: 'listing',
            workspaceId,
            matterId: item.matterId,
            ...(allowed === undefined ? {} : { restricted: { allowUserIds: allowed } }),
          },
          settings,
        ).allow;
      });
      const ranked = readable
        .filter((c) => free(c, target))
        .sort(
          (a, b) =>
            (history.get(item.matterId)?.get(b.memberId)?.count ?? 0) -
              (history.get(item.matterId)?.get(a.memberId)?.count ?? 0) ||
            (load.get(a.memberId) ?? 0) - (load.get(b.memberId) ?? 0) ||
            a.memberId.localeCompare(b.memberId),
        );
      return ranked[0];
    };
    const capacityFor = (target: Placed, memberId: string): Capacity =>
      history.get(target.item.matterId)?.get(memberId)?.capacity ??
      target.item.capacity ??
      'arguing';

    const suggestions: Suggestion[] = [];
    const proposed = new Set<string>();
    const propose = (
      target: Placed,
      to: Candidate,
      kind: Suggestion['kind'],
      reason: string,
    ): void => {
      proposed.add(target.item.listingId);
      take(to.memberId, target);
      suggestions.push({
        listingId: target.item.listingId,
        memberId: to.memberId,
        capacity: capacityFor(target, to.memberId),
        kind,
        reason: reason.slice(0, 200),
      });
    };

    const byListing = new Map(placed.map((p) => [p.item.listingId, p]));
    const candidatesForClash: ClashCandidate[] = placed.map((p) => ({
      listingId: p.item.listingId,
      proceedingId: p.item.proceedingId,
      forumId: p.forumId,
      hallId: p.item.hallId,
      itemNo: p.item.itemNo,
      listDate: date,
      memberIds: p.item.appearingMemberIds,
    }));
    for (const clash of detectClashes(candidatesForClash)) {
      const [, second] = clash.items;
      const target = byListing.get(second.listingId);
      const first = byListing.get(clash.items[0].listingId);
      if (target === undefined || first === undefined || proposed.has(target.item.listingId)) continue;
      // Move the item that is not the member's earlier one; the clashing member leaves it.
      const to = pick(target, new Set([clash.memberId]));
      if (to === undefined) continue;
      const who = nameOf.get(clash.memberId) ?? 'A member';
      const reason =
        clash.kind === 'hall'
          ? `${who} is listed in ${hallOf(first.item)} and ${hallOf(target.item)}; ${to.name} is free for ${hallOf(target.item)}.`
          : `${who} is listed in two court complexes; ${to.name} is free for ${hallOf(target.item)}.`;
      propose(target, to, clash.kind === 'hall' ? 'hall_clash' : 'complex_clash', reason);
    }
    for (const target of placed) {
      if (target.item.appearingMemberIds.length > 0 || proposed.has(target.item.listingId)) continue;
      const to = pick(target, new Set());
      if (to === undefined) continue;
      const before = history.get(target.item.matterId)?.get(to.memberId)?.count ?? 0;
      propose(
        target,
        to,
        'unassigned',
        before > 0
          ? `Nobody is on this item; ${to.name} has appeared on the matter before.`
          : `Nobody is on this item; ${to.name} has the lightest day.`,
      );
    }
    suggestions.sort((a, b) => a.listingId.localeCompare(b.listingId));
    return { date, suggestions };
  });
}
