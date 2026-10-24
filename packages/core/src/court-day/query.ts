// The court day read model (#58, ADR 0037): one day's listings grouped complex -> hall -> list type
// -> item, for the calling member (`mine`) or the whole workspace (`workspace`, needs
// `court_day.view_all`). It issues a fixed number of statements however many listings the day holds
// (listings with their matter, forum, hall, bench and counts; appearances; hall markers; matters
// expected but not listed) and groups in memory. Strategy-bearing fields (the marker note, the matter
// memory snippet) go only to roles with `strategy.read`; a sensitive matter is listed but carries no
// AI-derived field (normalised stage, confidence, memory).
import { can } from '@causedeck/auth/policy';
import { schema } from '@causedeck/db';
import {
  CourtDayQuery,
  type CourtDay,
  type CourtDayComplex,
  type CourtDayHall,
  type CourtDayItem,
  type CourtDayList,
  type ExpectedNotListed,
} from '@causedeck/validators';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';

import { forbidden } from '../shared/errors.ts';

import { itemOrdinal } from './diff.ts';
import { inCourtDayScope, parseInput, type CourtDayActor, type CourtDayDeps } from './scope.ts';

const {
  appearance,
  bench,
  courtDayMarker,
  courtHall,
  forum,
  hearing,
  listing,
  matter,
  matterRestriction,
  member,
  proceeding,
} = schema;

type ListKind = CourtDayItem['listType'];

/** Lists in display order: the daily list, then the rest; a supplementary list sorts after the daily. */
const LIST_ORDER: Record<ListKind, number> = { daily: 0, advance: 1, special: 2, supplementary: 3 };

const MEMORY_SNIPPET_MAX = 240;

function caseLabel(p: {
  caseTypeCode: string;
  number: string | null;
  year: number | null;
}): string {
  const no = p.number === null ? '' : ` ${p.number}`;
  return `${p.caseTypeCode}${no}${p.year === null ? '' : `/${p.year}`}`;
}

/** Item number order within a hall list: numeric (9 before 10), unnumbered last, ties by serial. */
function compareItems(a: CourtDayItem, b: CourtDayItem): number {
  const x = itemOrdinal(a.itemNo);
  const y = itemOrdinal(b.itemNo);
  if (x !== y) return x === null ? 1 : y === null ? -1 : x - y;
  return (
    (a.itemNo ?? '').localeCompare(b.itemNo ?? '') ||
    (a.listNo ?? 0) - (b.listNo ?? 0) ||
    a.listingId.localeCompare(b.listingId)
  );
}

function hallKey(hallId: string | null): string {
  return hallId ?? '';
}

/**
 * A day's court items. `scope` defaults to `mine` (the member's own matters and appearances);
 * `workspace` is FORBIDDEN without `court_day.view_all`.
 */
export async function getCourtDay(
  deps: CourtDayDeps,
  actor: CourtDayActor,
  input: CourtDayQuery,
): Promise<CourtDay> {
  const query = parseInput(CourtDayQuery, input);
  return inCourtDayScope(deps, actor, async (scope) => {
    const { tx } = scope;
    const { workspaceId, userId } = scope.actor;
    const settings = await scope.settings();
    if (!can(scope.actor, 'listing.read', undefined, settings).allow) {
      throw forbidden('You cannot read the court day');
    }
    if (query.scope === 'workspace' && !can(scope.actor, 'court_day.view_all', undefined, settings).allow) {
      throw forbidden('You cannot view the whole workspace court day');
    }
    const strategy = can(scope.actor, 'strategy.read', undefined, settings).allow;
    // The caller's member id as a subquery: no statement of its own.
    const me = sql`(select ${member.id} from ${member} where ${member.organizationId} = ${workspaceId} and ${member.userId} = ${userId})`;
    const mine = (matterOwner: typeof matter.ownerMemberId, listingId: typeof listing.id) =>
      sql`(${matterOwner} = ${me} or exists (select 1 from ${appearance} a join ${hearing} h on h.workspace_id = a.workspace_id and h.id = a.hearing_id where h.listing_id = ${listingId} and a.member_id = ${me}))`;
    const placed = sql`(${listing.itemNo} is not null or ${listing.hallId} is not null)`;
    const day = query.date;

    const rows = await tx
      .select({
        listing,
        proceeding: {
          caseTypeCode: proceeding.caseTypeCode,
          number: proceeding.number,
          year: proceeding.year,
          forumId: proceeding.forumId,
        },
        matter: {
          id: matter.id,
          title: matter.title,
          sensitive: matter.sensitive,
          ownerMemberId: matter.ownerMemberId,
          synopsis: matter.synopsis,
        },
        forumName: forum.court,
        hallNo: courtHall.hallNo,
        bench: bench.judges,
        allowedUserIds: matterRestriction.allowedUserIds,
        restricted: sql<boolean>`${matterRestriction.id} is not null`,
        openObligations: sql<number>`(select count(*)::int from obligation o where o.workspace_id = ${listing.workspaceId} and o.proceeding_id = ${listing.proceedingId} and o.status = 'open')`,
        carryCount: sql<number>`(select count(*)::int from listing p where p.workspace_id = ${listing.workspaceId} and p.proceeding_id = ${listing.proceedingId} and p.list_date < ${listing.listDate} and p.confirmation_state <> 'rejected')`,
      })
      .from(listing)
      .innerJoin(
        proceeding,
        and(eq(proceeding.workspaceId, listing.workspaceId), eq(proceeding.id, listing.proceedingId)),
      )
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .innerJoin(forum, eq(forum.id, proceeding.forumId))
      .leftJoin(courtHall, eq(courtHall.id, listing.hallId))
      .leftJoin(bench, eq(bench.id, listing.benchId))
      .leftJoin(
        matterRestriction,
        and(
          eq(matterRestriction.workspaceId, matter.workspaceId),
          eq(matterRestriction.matterId, matter.id),
        ),
      )
      .where(
        and(
          eq(listing.workspaceId, workspaceId),
          eq(listing.listDate, day),
          ne(listing.confirmationState, 'rejected'),
          placed,
          query.scope === 'mine' ? mine(matter.ownerMemberId, listing.id) : undefined,
        ),
      )
      .orderBy(asc(listing.id));

    // Restricted matters and matters a junior is not on stay out, as the matter reads do.
    const readable = rows.filter((r) =>
      can(
        scope.actor,
        'listing.read',
        {
          kind: 'listing',
          workspaceId,
          matterId: r.matter.id,
          ...(r.restricted ? { restricted: { allowUserIds: r.allowedUserIds ?? [] } } : {}),
        },
        settings,
      ).allow,
    );
    const listingIds = readable.map((r) => r.listing.id);

    const appearances =
      listingIds.length === 0
        ? []
        : await tx
            .select({
              listingId: hearing.listingId,
              memberId: appearance.memberId,
              capacity: appearance.capacity,
            })
            .from(appearance)
            .innerJoin(
              hearing,
              and(eq(hearing.workspaceId, appearance.workspaceId), eq(hearing.id, appearance.hearingId)),
            )
            .where(and(eq(appearance.workspaceId, workspaceId), inArray(hearing.listingId, listingIds)))
            .orderBy(asc(appearance.id));
    const markers = await tx
      .select()
      .from(courtDayMarker)
      .where(and(eq(courtDayMarker.workspaceId, workspaceId), eq(courtDayMarker.listDate, day)));
    const expected = await tx
      .select({
        proceedingId: proceeding.id,
        matterId: matter.id,
        matterTitle: matter.title,
        caseTypeCode: proceeding.caseTypeCode,
        number: proceeding.number,
        year: proceeding.year,
        restricted: sql<boolean>`${matterRestriction.id} is not null`,
        allowedUserIds: matterRestriction.allowedUserIds,
      })
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
      )
      .where(
        and(
          eq(listing.workspaceId, workspaceId),
          eq(listing.listDate, day),
          eq(listing.canonical, true),
          eq(listing.confirmationState, 'confirmed'),
          sql`not exists (select 1 from listing l2 where l2.workspace_id = ${listing.workspaceId} and l2.proceeding_id = ${listing.proceedingId} and l2.list_date = ${listing.listDate} and l2.confirmation_state <> 'rejected' and (l2.item_no is not null or l2.hall_id is not null))`,
          query.scope === 'mine' ? sql`${matter.ownerMemberId} = ${me}` : undefined,
        ),
      )
      .orderBy(asc(matter.title), asc(proceeding.id));

    const byListing = new Map<string, typeof appearances>();
    for (const a of appearances) {
      const list = byListing.get(a.listingId);
      if (list === undefined) byListing.set(a.listingId, [a]);
      else list.push(a);
    }

    const complexes = new Map<
      string,
      { name: string; halls: Map<string, { hallNo: string | null; hallId: string | null; items: CourtDayItem[] }> }
    >();
    let freshness: Date | null = null;
    for (const r of readable) {
      const l = r.listing;
      const appears = byListing.get(l.id) ?? [];
      const ownApp = appears.find((a) => a.memberId !== null && a.memberId === r.matter.ownerMemberId);
      const ai = !r.matter.sensitive;
      const item: CourtDayItem = {
        listingId: l.id,
        proceedingId: l.proceedingId,
        matterId: r.matter.id,
        matterTitle: r.matter.title,
        caseLabel: caseLabel(r.proceeding),
        listType: l.listType,
        listNo: l.listNo,
        itemNo: l.itemNo,
        hallId: l.hallId,
        hallNo: r.hallNo,
        stageRaw: l.stageRaw,
        bench: r.bench ?? [],
        capacity: (ownApp ?? appears[0])?.capacity ?? null,
        appearingMemberIds: [
          ...new Set(appears.flatMap((a) => (a.memberId === null ? [] : [a.memberId]))),
        ],
        assigneeMemberId: r.matter.ownerMemberId,
        openObligations: r.openObligations,
        carryCount: r.carryCount,
        sourceType: l.sourceType,
        anchorId: l.anchorId,
        confirmationState: l.confirmationState,
        sensitive: r.matter.sensitive,
        ...(ai ? { stageNorm: l.stageNorm, confidence: l.confidence } : {}),
        ...(ai && strategy && r.matter.synopsis !== null
          ? { matterMemory: r.matter.synopsis.slice(0, MEMORY_SNIPPET_MAX) }
          : {}),
      };
      if (freshness === null || l.capturedAt > freshness) freshness = l.capturedAt;
      let complex = complexes.get(r.proceeding.forumId);
      if (complex === undefined) {
        complex = { name: r.forumName, halls: new Map() };
        complexes.set(r.proceeding.forumId, complex);
      }
      const key = hallKey(l.hallId);
      let hall = complex.halls.get(key);
      if (hall === undefined) {
        hall = { hallNo: r.hallNo, hallId: l.hallId, items: [] };
        complex.halls.set(key, hall);
      }
      hall.items.push(item);
    }

    const markerOf = (hallId: string | null): CourtDayHall['marker'] => {
      const m = markers.find((x) => x.hallId === hallId);
      if (m === undefined) return null;
      return {
        currentItem: m.currentItem,
        setBy: m.setBy,
        setAt: m.setAt,
        ...(strategy ? { note: m.note } : {}),
      };
    };

    const out: CourtDayComplex[] = [...complexes.entries()]
      .map(([forumId, c]) => ({
        forumId,
        name: c.name,
        halls: [...c.halls.values()]
          .sort(
            (a, b) =>
              (a.hallNo === null ? 1 : 0) - (b.hallNo === null ? 1 : 0) ||
              (itemOrdinal(a.hallNo) ?? 0) - (itemOrdinal(b.hallNo) ?? 0) ||
              (a.hallNo ?? '').localeCompare(b.hallNo ?? ''),
          )
          .map((h): CourtDayHall => {
            const lists = new Map<ListKind, CourtDayItem[]>();
            for (const item of h.items) {
              const group = lists.get(item.listType);
              if (group === undefined) lists.set(item.listType, [item]);
              else group.push(item);
            }
            return {
              hallId: h.hallId,
              hallNo: h.hallNo,
              marker: h.hallId === null ? null : markerOf(h.hallId),
              lists: [...lists.entries()]
                .sort(([a], [b]) => LIST_ORDER[a] - LIST_ORDER[b])
                .map(([listType, items]): CourtDayList => ({
                  listType,
                  items: items.sort(compareItems),
                })),
            };
          }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.forumId.localeCompare(b.forumId));

    const expectedNotListed: ExpectedNotListed[] = expected
      .filter((e) =>
        can(
          scope.actor,
          'listing.read',
          {
            kind: 'listing',
            workspaceId,
            matterId: e.matterId,
            ...(e.restricted ? { restricted: { allowUserIds: e.allowedUserIds ?? [] } } : {}),
          },
          settings,
        ).allow,
      )
      .map((e) => ({
        proceedingId: e.proceedingId,
        matterId: e.matterId,
        matterTitle: e.matterTitle,
        caseLabel: caseLabel(e),
      }));

    return { date: day, scope: query.scope, complexes: out, expectedNotListed, freshness };
  });
}
