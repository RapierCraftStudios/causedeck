// The calendar range read model (#66): the days of a week or month with the listings, next dates,
// open obligation due dates and forum closures that fall on them, for the calling member (`mine`) or
// the whole workspace (`workspace`, needs `court_day.view_all`). One statement per source however
// many days the range spans (listings, appearances for clashes, hearing next dates, obligations,
// forums, and each forum's closure calendar), grouped in memory; `getCourtDay` is not called per day.
// A restricted matter the caller may not read is kept as a redacted entry (date and kind only). A
// proposed date is shown but never counted as a confirmed commitment. Strategy-bearing fields (the
// raw stage, the obligation text) go only to roles with `strategy.read`. No judge or bench data.
import { can } from '@causedeck/auth/policy';
import { schema } from '@causedeck/db';
import {
  CalendarRange,
  type CalendarDay,
  type CalendarEntry,
  type CalendarDayCounts,
} from '@causedeck/validators';
import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

import { loadCourtCalendar } from '../deadlines/index.ts';
import { forbidden } from '../shared/errors.ts';

import { detectClashes, type ClashCandidate } from './clashes.ts';
import {
  inCourtDayScope,
  parseCourtDayInput,
  type CourtDayActor,
  type CourtDayDeps,
} from './scope.ts';

const {
  appearance,
  courtHall,
  forum,
  hearing,
  listing,
  matter,
  matterRestriction,
  member,
  obligation,
  proceeding,
} = schema;

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function caseLabel(p: {
  caseTypeCode: string;
  number: string | null;
  year: number | null;
}): string {
  const parts = [
    p.caseTypeCode,
    p.number === null ? null : `${p.number}${p.year === null ? '' : `/${String(p.year)}`}`,
  ];
  return parts.filter((x) => x !== null).join(' ');
}

const EMPTY_COUNTS: CalendarDayCounts = {
  listings: 0,
  nextDates: 0,
  obligationsDue: 0,
  proposed: 0,
  confirmed: 0,
};

/**
 * The days from `from` to `to` (at most 42, inclusive), each with its entries, counts, clash flag and
 * closure. `scope` defaults to `mine`; `workspace` is FORBIDDEN without `court_day.view_all`.
 */
export async function getCalendarRange(
  deps: CourtDayDeps,
  actor: CourtDayActor,
  input: CalendarRange,
): Promise<CalendarDay[]> {
  const query = parseCourtDayInput(CalendarRange, input);
  return inCourtDayScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId, userId } = scope.actor;
    const settings = await scope.settings();
    if (!can(scope.actor, 'listing.read', undefined, settings).allow) {
      throw forbidden('You cannot read the calendar');
    }
    if (
      query.scope === 'workspace' &&
      !can(scope.actor, 'court_day.view_all', undefined, settings).allow
    ) {
      throw forbidden('You cannot view the whole workspace calendar');
    }
    const strategy = can(scope.actor, 'strategy.read', undefined, settings).allow;
    const me = sql`(select ${member.id} from ${member} where ${member.organizationId} = ${workspaceId} and ${member.userId} = ${userId})`;
    const readable = (matterId: string, restricted: boolean, allowed: string[] | null) =>
      can(
        scope.actor,
        'listing.read',
        {
          kind: 'listing',
          workspaceId,
          matterId,
          ...(restricted ? { restricted: { allowUserIds: allowed ?? [] } } : {}),
        },
        settings,
      ).allow;

    const days = new Map<string, CalendarDay>();
    for (let d = query.from; d <= query.to; d = addDays(d, 1)) {
      days.set(d, {
        date: d,
        counts: { ...EMPTY_COUNTS },
        clash: false,
        closedReason: null,
        entries: [],
      });
    }
    const add = (date: string, entry: Omit<CalendarEntry, 'date'>) => {
      const dayRow = days.get(date);
      if (dayRow === undefined) return;
      dayRow.entries.push({ ...entry, date });
      if (entry.kind === 'holiday' || entry.kind === 'vacation') {
        dayRow.closedReason ??= entry.label;
        return;
      }
      const c = dayRow.counts;
      if (entry.kind === 'listing') c.listings += 1;
      else if (entry.kind === 'next_date') c.nextDates += entry.proposed ? 0 : 1;
      else c.obligationsDue += 1;
      if (entry.proposed) c.proposed += 1;
      else c.confirmed += 1;
    };
    const base = {
      redacted: false,
      matterId: null,
      matterTitle: null,
      proceedingId: null,
      caseLabel: null,
      forumName: null,
      hallNo: null,
      itemNo: null,
      label: null,
    } satisfies Omit<CalendarEntry, 'kind' | 'date' | 'proposed'>;
    const redactedEntry = { ...base, redacted: true } as const;

    const restriction = and(
      eq(matterRestriction.workspaceId, matter.workspaceId),
      eq(matterRestriction.matterId, matter.id),
    );

    // Listings placed in a hall or with an item number, as the court day lists them.
    const listings = await tx
      .select({
        id: listing.id,
        listDate: listing.listDate,
        itemNo: listing.itemNo,
        hallId: listing.hallId,
        stageRaw: listing.stageRaw,
        confirmationState: listing.confirmationState,
        proceedingId: proceeding.id,
        forumId: proceeding.forumId,
        caseTypeCode: proceeding.caseTypeCode,
        number: proceeding.number,
        year: proceeding.year,
        matterId: matter.id,
        matterTitle: matter.title,
        forumName: forum.court,
        hallNo: courtHall.hallNo,
        allowedUserIds: matterRestriction.allowedUserIds,
        restricted: sql<boolean>`${matterRestriction.id} is not null`,
      })
      .from(listing)
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, listing.workspaceId),
          eq(proceeding.id, listing.proceedingId),
        ),
      )
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .innerJoin(forum, eq(forum.id, proceeding.forumId))
      .leftJoin(courtHall, eq(courtHall.id, listing.hallId))
      .leftJoin(matterRestriction, restriction)
      .where(
        and(
          eq(listing.workspaceId, workspaceId),
          gte(listing.listDate, query.from),
          lte(listing.listDate, query.to),
          sql`(${listing.itemNo} is not null or ${listing.hallId} is not null)`,
          query.scope === 'mine'
            ? sql`(${matter.ownerMemberId} = ${me} or exists (select 1 from ${appearance} a join ${hearing} h on h.workspace_id = a.workspace_id and h.id = a.hearing_id where h.listing_id = ${listing.id} and a.member_id = ${me}))`
            : undefined,
        ),
      )
      .orderBy(asc(listing.listDate), asc(listing.id));

    const appearances =
      listings.length === 0
        ? []
        : await tx
            .select({ listingId: hearing.listingId, memberId: appearance.memberId })
            .from(appearance)
            .innerJoin(
              hearing,
              and(
                eq(hearing.workspaceId, appearance.workspaceId),
                eq(hearing.id, appearance.hearingId),
              ),
            )
            .where(
              and(
                eq(appearance.workspaceId, workspaceId),
                inArray(
                  hearing.listingId,
                  listings.map((l) => l.id),
                ),
              ),
            );
    const membersOf = new Map<string, string[]>();
    for (const a of appearances) {
      if (a.memberId === null) continue;
      const list = membersOf.get(a.listingId);
      if (list === undefined) membersOf.set(a.listingId, [a.memberId]);
      else list.push(a.memberId);
    }

    const candidates: ClashCandidate[] = [];
    for (const l of listings) {
      const proposed = l.confirmationState === 'proposed';
      if (!readable(l.matterId, l.restricted, l.allowedUserIds)) {
        add(l.listDate, { ...redactedEntry, kind: 'listing', proposed });
        continue;
      }
      add(l.listDate, {
        ...base,
        kind: 'listing',
        proposed,
        matterId: l.matterId,
        matterTitle: l.matterTitle,
        proceedingId: l.proceedingId,
        caseLabel: caseLabel(l),
        forumName: l.forumName,
        hallNo: l.hallNo,
        itemNo: l.itemNo,
        ...(strategy ? { stage: l.stageRaw } : {}),
      });
      candidates.push({
        listingId: l.id,
        proceedingId: l.proceedingId,
        forumId: l.forumId,
        hallId: l.hallId,
        itemNo: l.itemNo,
        listDate: l.listDate,
        memberIds: membersOf.get(l.id) ?? [],
      });
    }
    for (const clash of detectClashes(candidates)) {
      const dayRow = days.get(clash.date);
      if (dayRow !== undefined) dayRow.clash = true;
    }

    // Next dates recorded on hearings: confirmed ones count, proposed ones (not yet confirmed) do not.
    const nextDates = await tx
      .select({
        confirmed: hearing.nextDateConfirmed,
        proposed: hearing.nextDateProposed,
        proceedingId: proceeding.id,
        caseTypeCode: proceeding.caseTypeCode,
        number: proceeding.number,
        year: proceeding.year,
        matterId: matter.id,
        matterTitle: matter.title,
        forumName: forum.court,
        allowedUserIds: matterRestriction.allowedUserIds,
        restricted: sql<boolean>`${matterRestriction.id} is not null`,
      })
      .from(hearing)
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
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .innerJoin(forum, eq(forum.id, proceeding.forumId))
      .leftJoin(matterRestriction, restriction)
      .where(
        and(
          eq(hearing.workspaceId, workspaceId),
          or(
            and(
              gte(hearing.nextDateConfirmed, query.from),
              lte(hearing.nextDateConfirmed, query.to),
            ),
            and(gte(hearing.nextDateProposed, query.from), lte(hearing.nextDateProposed, query.to)),
          ),
          query.scope === 'mine' ? sql`${matter.ownerMemberId} = ${me}` : undefined,
        ),
      )
      .orderBy(asc(hearing.id));
    for (const n of nextDates) {
      // A confirmed date is the commitment; a proposed one only shows while nothing is confirmed.
      const date = n.confirmed ?? n.proposed;
      if (date === null) continue;
      const proposed = n.confirmed === null;
      if (!readable(n.matterId, n.restricted, n.allowedUserIds)) {
        add(date, { ...redactedEntry, kind: 'next_date', proposed });
        continue;
      }
      add(date, {
        ...base,
        kind: 'next_date',
        proposed,
        matterId: n.matterId,
        matterTitle: n.matterTitle,
        proceedingId: n.proceedingId,
        caseLabel: caseLabel(n),
        forumName: n.forumName,
      });
    }

    const due = await tx
      .select({
        dueDate: obligation.dueDate,
        description: obligation.description,
        provenance: obligation.confirmationState,
        proceedingId: obligation.proceedingId,
        matterId: matter.id,
        matterTitle: matter.title,
        allowedUserIds: matterRestriction.allowedUserIds,
        restricted: sql<boolean>`${matterRestriction.id} is not null`,
      })
      .from(obligation)
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, obligation.workspaceId), eq(matter.id, obligation.matterId)),
      )
      .leftJoin(matterRestriction, restriction)
      .where(
        and(
          eq(obligation.workspaceId, workspaceId),
          eq(obligation.status, 'open'),
          gte(obligation.dueDate, query.from),
          lte(obligation.dueDate, query.to),
          query.scope === 'mine'
            ? sql`(${obligation.ownerMemberId} = ${me} or ${matter.ownerMemberId} = ${me})`
            : undefined,
        ),
      )
      .orderBy(asc(obligation.dueDate), asc(obligation.id));
    for (const o of due) {
      if (o.dueDate === null) continue;
      const proposed = o.provenance === 'proposed';
      if (!readable(o.matterId, o.restricted, o.allowedUserIds)) {
        add(o.dueDate, { ...redactedEntry, kind: 'obligation_due', proposed });
        continue;
      }
      add(o.dueDate, {
        ...base,
        kind: 'obligation_due',
        proposed,
        matterId: o.matterId,
        matterTitle: o.matterTitle,
        proceedingId: o.proceedingId,
        label: strategy ? o.description : null,
      });
    }

    // Forum closures: holiday notices matched to the workspace and the static vacation table, for the
    // forums its proceedings are before. Absent data leaves the day without a marker.
    const forums = await tx
      .selectDistinct({ code: forum.code, court: forum.court })
      .from(proceeding)
      .innerJoin(forum, eq(forum.id, proceeding.forumId))
      .where(eq(proceeding.workspaceId, workspaceId))
      .orderBy(asc(forum.code));
    for (const f of forums) {
      const calendar = await loadCourtCalendar(tx, workspaceId, {
        forumCode: f.code,
        from: query.from,
        to: query.to,
      });
      for (const [date, title] of calendar.holidays) {
        add(date, { ...base, kind: 'holiday', proposed: false, forumName: f.court, label: title });
      }
      for (const v of calendar.vacations) {
        for (
          let d = v.from > query.from ? v.from : query.from;
          d <= v.to && d <= query.to;
          d = addDays(d, 1)
        ) {
          add(d, { ...base, kind: 'vacation', proposed: false, forumName: f.court, label: v.name });
        }
      }
    }

    return [...days.values()];
  });
}
