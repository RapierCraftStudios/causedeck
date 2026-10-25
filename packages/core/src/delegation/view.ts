// Delegation reads (#63): the member's own appearances for a day (`myAppearances`, the junior's
// `Mine`) and the owner's live outcome strip (`chamberOutcomesLive`). A matter the reader may not see
// stays out; the delegator's note is a strategy field and goes only to roles with `strategy.read`
// (not a clerk); an outcome is shown only once the assignee confirmed it.
import { can } from '@causedeck/auth/policy';
import { schema } from '@causedeck/db';
import {
  DayInput,
  type DelegationView,
  type OutcomesLive,
} from '@causedeck/validators';
import { and, asc, eq, sql } from 'drizzle-orm';

import { forbidden, notFound } from '../shared/errors.ts';

import {
  inDelegationScope,
  parseDelegationInput,
  type DelegationActor,
  type DelegationDeps,
} from './scope.ts';

const {
  appearance,
  courtHall,
  hearing,
  listing,
  matter,
  matterRestriction,
  member,
  proceeding,
  user,
} = schema;

function caseLabel(p: { caseTypeCode: string; number: string | null; year: number | null }): string {
  const no = p.number === null ? '' : ` ${p.number}`;
  return `${p.caseTypeCode}${no}${p.year === null ? '' : `/${String(p.year)}`}`;
}

/** The day's appearances joined to what a reader needs; `where` narrows by member or none. */
function dayRows(scope: Parameters<Parameters<typeof inDelegationScope>[2]>[0], date: string) {
  return scope.tx
    .select({
      appearanceId: appearance.id,
      listingId: listing.id,
      matterId: matter.id,
      matterTitle: matter.title,
      sensitive: matter.sensitive,
      caseTypeCode: proceeding.caseTypeCode,
      number: proceeding.number,
      year: proceeding.year,
      listDate: listing.listDate,
      itemNo: listing.itemNo,
      hallNo: courtHall.hallNo,
      memberId: appearance.memberId,
      capacity: appearance.capacity,
      assignedByMemberId: appearance.assignedByMemberId,
      note: appearance.note,
      outcome: hearing.outcome,
      adjournmentReason: hearing.adjournmentReason,
      nextDateProposed: hearing.nextDateProposed,
      nextDateConfirmed: hearing.nextDateConfirmed,
      confirmationState: hearing.confirmationState,
      confirmedAt: hearing.updatedAt,
      restricted: sql<boolean>`${matterRestriction.id} is not null`,
      allowedUserIds: matterRestriction.allowedUserIds,
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
    .leftJoin(courtHall, eq(courtHall.id, listing.hallId))
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    )
    .where(and(eq(appearance.workspaceId, scope.actor.workspaceId), eq(listing.listDate, date)))
    .orderBy(asc(listing.itemNo), asc(appearance.id));
}

/**
 * The calling member's own appearances on `date`, on matters they may see. Others' appearances and
 * unassigned items never appear.
 */
export async function myAppearances(
  deps: DelegationDeps,
  actor: DelegationActor,
  input: DayInput,
): Promise<DelegationView> {
  const { date } = parseDelegationInput(DayInput, input);
  return inDelegationScope(deps, actor, async (scope) => {
    const { workspaceId, userId } = scope.actor;
    const settings = await scope.settings();
    if (!can(scope.actor, 'listing.read', undefined, settings).allow) {
      throw forbidden('You cannot read the court day');
    }
    const strategy = can(scope.actor, 'strategy.read', undefined, settings).allow;
    const [me] = await scope.tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)))
      .limit(1);
    if (me === undefined) throw notFound('Workspace not found');
    const rows = (await dayRows(scope, date)).filter(
      (r) =>
        r.memberId === me.id &&
        can(
          scope.actor,
          'listing.read',
          {
            kind: 'listing',
            workspaceId,
            matterId: r.matterId,
            ...(r.restricted ? { restricted: { allowUserIds: r.allowedUserIds ?? [] } } : {}),
          },
          settings,
        ).allow,
    );
    return {
      date,
      appearances: rows.map((r) => ({
        appearanceId: r.appearanceId,
        listingId: r.listingId,
        matterId: r.matterId,
        matterTitle: r.matterTitle,
        caseLabel: caseLabel(r),
        listDate: r.listDate,
        itemNo: r.itemNo,
        hallNo: r.hallNo,
        memberId: r.memberId,
        capacity: r.capacity,
        assignedByMemberId: r.assignedByMemberId,
        ...(strategy ? { note: r.note } : {}),
        sensitive: r.sensitive,
      })),
    };
  });
}

/**
 * Per delegated member, how the day is going: items, items with a recorded result, and items whose
 * outcome the assignee confirmed (the outcome text only for those). Needs `court_day.view_all`.
 */
export async function chamberOutcomesLive(
  deps: DelegationDeps,
  actor: DelegationActor,
  input: DayInput,
): Promise<OutcomesLive> {
  const { date } = parseDelegationInput(DayInput, input);
  return inDelegationScope(deps, actor, async (scope) => {
    const { workspaceId } = scope.actor;
    const settings = await scope.settings();
    if (!can(scope.actor, 'court_day.view_all', undefined, settings).allow) {
      throw forbidden('You cannot view the whole workspace court day');
    }
    const names = new Map(
      (
        await scope.tx
          .select({ id: member.id, name: user.name })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(eq(member.organizationId, workspaceId))
      ).map((m) => [m.id, m.name]),
    );
    const rows = (await dayRows(scope, date)).filter(
      (r) =>
        r.memberId !== null &&
        r.assignedByMemberId !== null &&
        can(
          scope.actor,
          'listing.read',
          {
            kind: 'listing',
            workspaceId,
            matterId: r.matterId,
            ...(r.restricted ? { restricted: { allowUserIds: r.allowedUserIds ?? [] } } : {}),
          },
          settings,
        ).allow,
    );
    const byMember = new Map<string, OutcomesLive['members'][number]>();
    let last: Date | null = null;
    for (const r of rows) {
      if (r.memberId === null) continue;
      const confirmed = r.confirmationState === 'confirmed';
      const recorded =
        r.outcome !== null ||
        r.adjournmentReason !== null ||
        r.nextDateProposed !== null ||
        r.nextDateConfirmed !== null;
      const entry = byMember.get(r.memberId) ?? {
        memberId: r.memberId,
        name: names.get(r.memberId) ?? '',
        total: 0,
        heard: 0,
        outcomesIn: 0,
        items: [],
      };
      entry.total += 1;
      if (recorded) entry.heard += 1;
      if (confirmed) {
        entry.outcomesIn += 1;
        if (last === null || r.confirmedAt > last) last = r.confirmedAt;
      }
      entry.items.push({
        appearanceId: r.appearanceId,
        listingId: r.listingId,
        itemNo: r.itemNo,
        outcome: confirmed ? r.outcome : null,
        confirmed,
      });
      byMember.set(r.memberId, entry);
    }
    return {
      date,
      members: [...byMember.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId),
      ),
      lastConfirmedAt: last,
    };
  });
}
