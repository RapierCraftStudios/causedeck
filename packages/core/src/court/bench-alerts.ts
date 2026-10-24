// Bench-notice alerts (#496, D-048): an official notice about a leave, a special bench or a roster
// reassignment is mapped to the listings and matters it affects, and each member who may read an
// affected matter is told once per notice. Nothing is stored: like `listHolidayListings`, the
// mapping is a read over `notice_match`, `listing` and `proceeding`, so a notice that arrives after
// a listing still alerts. Notices carry no structured bench data, so a deterministic classifier
// reads the title for the kind of change, the court hall numbers and the case types it names; a
// notice naming neither a hall nor a case type affects nothing. A listing is affected when its
// proceeding's forum is named by the notice, it falls in the notice's window, and it is in a named
// hall and/or of a named case type. Judges are never read, matched or named (PX-9, ME-6, D-050):
// the notice's own text is the only input. No AI. Alerts go through `notify()` in the
// `bench_change` category, with a counts-only body (no party names), deduplicated per notice.
import { isRole } from '@causedeck/auth';
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import {
  isUuid,
  schema,
  withWorkspace,
  type Database,
  type Queryable,
  type Transaction,
} from '@causedeck/db';
import { notify, type DeliveryJob } from '@causedeck/notifications';
import { and, asc, desc, eq, gte, lte, notInArray, sql } from 'drizzle-orm';

import { notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import { portfolioRuleMatches } from './bench-change.ts';

const {
  courtHall,
  forum,
  listing,
  matter,
  member,
  notice,
  noticeMatch,
  organization,
  proceeding,
  source,
} = schema;

export const BENCH_NOTICE_TYPES = ['leave', 'special_bench', 'roster_reassignment'] as const;
export type BenchNoticeType = (typeof BENCH_NOTICE_TYPES)[number];

/** What a notice title says about the bench change. */
export interface BenchNoticeClass {
  type: BenchNoticeType;
  /** Upper-case hall numbers named by the title ("12A"); empty when none is named. */
  hallNos: string[];
  /** Case type codes named by the title ("WP", "CRLA", dots removed); empty when none is named. */
  caseTypes: string[];
}

/** Days after the notice's date that a leave or special-bench notice covers. */
export const BENCH_NOTICE_WINDOW_DAYS = 14;

/** Rows read per call, before the per-notice classification. */
const ROW_LIMIT = 1000;
const TITLE_MAX = 200;

const SPECIAL = /\bspecial\s+(?:bench|sitting)s?\b/i;
const LEAVE = /\bon\s+leave\b|\bleave\s+of\s+absence\b|\bnot\s+sit(?:ting)?\b|\bwill\s+not\s+sit\b/i;
const REASSIGN =
  /\brosters?\b|\bre-?assign\w*|\bre-?allot\w*|\bre-?constitut\w*|\bbench\s+(?:change|composition|constitution)\b/i;

const HALL_LIST = String.raw`\d{1,3}[A-Za-z]?(?:\s*(?:,|and|&)\s*\d{1,3}[A-Za-z]?)*`;
const HALL = new RegExp(
  String.raw`\b(?:court\s+hall|hall|court)s?\s*(?:nos?\.?|numbers?)?\s*:?\s*(${HALL_LIST})\b`,
  'gi',
);

/** Case type codes a title may name, as stored (upper-case, no dots). */
const CASE_TYPES: ReadonlySet<string> = new Set([
  'WP',
  'WA',
  'WPMP',
  'CRLA',
  'CRLP',
  'CRLOP',
  'CRLRC',
  'CRP',
  'CMP',
  'CMA',
  'SA',
  'TCA',
  'OP',
  'AS',
  'MP',
  'HCP',
  'RP',
  'CCC',
  'CS',
  'CA',
  'FA',
  'MFA',
  'RFA',
  'RSA',
  'LPA',
  'SLP',
  'CRA',
  'TC',
]);

const CASE_TYPE_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\bwrit\s+petitions?\b/i, 'WP'],
  [/\bwrit\s+appeals?\b/i, 'WA'],
  [/\bcriminal\s+appeals?\b/i, 'CRLA'],
  [/\bcriminal\s+original\s+petitions?\b/i, 'CRLOP'],
  [/\bcivil\s+revision\s+petitions?\b/i, 'CRP'],
  [/\bsecond\s+appeals?\b/i, 'SA'],
  [/\bhabeas\s+corpus\b/i, 'HCP'],
  [/\bfirst\s+appeals?\b/i, 'FA'],
  [/\bletters\s+patent\s+appeals?\b/i, 'LPA'],
];

const caseTypeKey = (raw: string) => raw.toUpperCase().replace(/[.\s\-_]/g, '');

/** The hall numbers a title names. */
function hallsIn(title: string): string[] {
  const halls = new Set<string>();
  for (const found of title.matchAll(HALL)) {
    for (const part of (found[1] ?? '').split(/\s*(?:,|and|&)\s*/i)) {
      if (part !== '') halls.add(part.toUpperCase());
    }
  }
  return [...halls];
}

/** The case types a title names, as codes or as words. */
function caseTypesIn(title: string): string[] {
  const types = new Set<string>();
  for (const [pattern, code] of CASE_TYPE_WORDS) if (pattern.test(title)) types.add(code);
  // Bare acronyms only when written in capitals ("WP", "SA"); dotted forms in any case ("W.P.").
  for (const token of title.match(/\b[A-Z]{2,5}\b|\b[A-Za-z]{1,4}(?:\.[A-Za-z]{1,4})+\.?/g) ?? []) {
    const key = caseTypeKey(token);
    if (CASE_TYPES.has(key)) types.add(key);
  }
  return [...types];
}

/**
 * Classify a notice title as a special bench, a leave or a roster reassignment, with the halls and
 * case types it names; null when it is none of these or names neither a hall nor a case type.
 */
export function classifyBenchNotice(title: string): BenchNoticeClass | null {
  const type: BenchNoticeType | null = SPECIAL.test(title)
    ? 'special_bench'
    : LEAVE.test(title)
      ? 'leave'
      : REASSIGN.test(title)
        ? 'roster_reassignment'
        : null;
  if (type === null) return null;
  const hallNos = hallsIn(title);
  const caseTypes = caseTypesIn(title);
  if (hallNos.length === 0 && caseTypes.length === 0) return null;
  return { type, hallNos, caseTypes };
}

/** The member reading or being told. */
export interface BenchNoticeActor {
  workspaceId: string;
  userId: string;
}

export interface ListBenchNoticeAlertsInput {
  /** Narrow to one matter. */
  matterId?: string;
  /** First listing day (ISO date), inclusive. */
  from?: string;
  /** Last listing day (ISO date), inclusive. */
  to?: string;
}

/** One notice affecting one matter. */
export interface BenchNoticeAlert {
  noticeId: string;
  title: string;
  /** The official notice URL (the alert's source link). */
  url: string;
  kind: (typeof notice.$inferSelect)['kind'];
  type: BenchNoticeType;
  issuedOn: string;
  effectiveOn: string | null;
  sourceName: string;
  matterId: string;
  matterTitle: string;
  /** The affected listings' days, ascending. */
  listDates: string[];
}

interface Scope {
  workspaceId: string;
  reader: Actor;
  settings: PolicySettings;
}

const matterOwnerUserId = sql`(select ${member.userId} from ${member} where ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId})`;

const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The notices matched to a matter's forum whose listings a bench change affects, for `scope.reader`. */
async function affected(
  tx: Transaction,
  scope: Scope,
  filter: ListBenchNoticeAlertsInput & { noticeId?: string },
): Promise<BenchNoticeAlert[]> {
  const rows = await tx
    .select({
      noticeId: notice.id,
      title: notice.title,
      url: notice.url,
      kind: notice.kind,
      issuedOn: notice.issuedOn,
      effectiveOn: notice.effectiveOn,
      sourceName: source.owner,
      matterId: matter.id,
      matterTitle: matter.title,
      listDate: listing.listDate,
      hallNo: courtHall.hallNo,
      caseTypeCode: proceeding.caseTypeCode,
      year: proceeding.year,
    })
    .from(noticeMatch)
    .innerJoin(notice, eq(notice.id, noticeMatch.noticeId))
    .innerJoin(source, eq(source.id, notice.sourceId))
    .innerJoin(
      proceeding,
      and(
        eq(proceeding.workspaceId, noticeMatch.workspaceId),
        eq(proceeding.matterId, noticeMatch.matterId),
      ),
    )
    .innerJoin(forum, eq(forum.id, proceeding.forumId))
    .innerJoin(
      matter,
      and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
    )
    .innerJoin(
      listing,
      and(
        eq(listing.workspaceId, proceeding.workspaceId),
        eq(listing.proceedingId, proceeding.id),
        gte(listing.listDate, sql`coalesce(${notice.effectiveOn}, ${notice.issuedOn})`),
        filter.from === undefined ? undefined : gte(listing.listDate, filter.from),
        filter.to === undefined ? undefined : lte(listing.listDate, filter.to),
      ),
    )
    .leftJoin(courtHall, eq(courtHall.id, listing.hallId))
    .where(
      and(
        eq(noticeMatch.workspaceId, scope.workspaceId),
        eq(noticeMatch.reason, 'matter_forum'),
        notInArray(notice.kind, ['holiday', 'gazette', 'bar_council']),
        sql`${forum.code} = any(${notice.forumCodes})`,
        sql`${proceeding.state} <> 'disposed'`,
        filter.noticeId === undefined ? undefined : eq(notice.id, filter.noticeId),
        filter.matterId === undefined ? undefined : eq(matter.id, filter.matterId),
        matterVisibilityPredicate(scope.reader, matter.id, {
          settings: scope.settings,
          ownerUserId: matterOwnerUserId,
        }),
      ),
    )
    .orderBy(desc(notice.issuedOn), asc(notice.id), asc(matter.id), asc(listing.listDate))
    .limit(ROW_LIMIT);

  const classes = new Map<string, BenchNoticeClass | null>();
  const out = new Map<string, BenchNoticeAlert>();
  for (const row of rows) {
    if (!classes.has(row.noticeId)) classes.set(row.noticeId, classifyBenchNotice(row.title));
    const cls = classes.get(row.noticeId);
    if (cls === undefined || cls === null) continue;
    if (cls.type !== 'roster_reassignment') {
      const start = row.effectiveOn ?? row.issuedOn;
      if (row.listDate > addDays(start, BENCH_NOTICE_WINDOW_DAYS)) continue;
    }
    if (cls.hallNos.length > 0 && !cls.hallNos.includes((row.hallNo ?? '').toUpperCase())) continue;
    if (
      cls.caseTypes.length > 0 &&
      !portfolioRuleMatches(
        { caseTypes: cls.caseTypes },
        { caseTypeCode: row.caseTypeCode, year: row.year },
      )
    ) {
      continue;
    }
    const key = `${row.noticeId}:${row.matterId}`;
    const found = out.get(key);
    if (found === undefined) {
      out.set(key, {
        noticeId: row.noticeId,
        title: row.title,
        url: row.url,
        kind: row.kind,
        type: cls.type,
        issuedOn: row.issuedOn,
        effectiveOn: row.effectiveOn,
        sourceName: row.sourceName,
        matterId: row.matterId,
        matterTitle: row.matterTitle,
        listDates: [row.listDate],
      });
    } else if (!found.listDates.includes(row.listDate)) {
      found.listDates.push(row.listDate);
    }
  }
  return [...out.values()];
}

async function readerScope(
  tx: Transaction,
  workspaceId: string,
  userId: string,
): Promise<Scope | null> {
  const role = await memberRole(tx, userId, workspaceId);
  if (role === null || !isRole(role)) return null;
  const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
  const reader: Actor = { userId, workspaceId, role };
  if (!can(reader, 'matter.read', undefined, settings).allow) return null;
  return { workspaceId, reader, settings };
}

/**
 * The notices that affect the listings of matters the actor may read, newest issued first.
 * NOT_FOUND for a malformed id or a non-member; nothing for a member who may not read matters.
 */
export async function listBenchNoticeAlerts(
  db: Queryable,
  actor: BenchNoticeActor,
  input: ListBenchNoticeAlertsInput = {},
): Promise<BenchNoticeAlert[]> {
  if (
    !isUuid(actor.workspaceId) ||
    !isUuid(actor.userId) ||
    (input.matterId !== undefined && !isUuid(input.matterId))
  ) {
    throw notFound('Matter not found');
  }
  return withWorkspace(db, { workspaceId: actor.workspaceId, userId: actor.userId }, async (tx) => {
    const role = await memberRole(tx, actor.userId, actor.workspaceId);
    if (role === null || !isRole(role)) throw notFound('Matter not found');
    const scope = await readerScope(tx, actor.workspaceId, actor.userId);
    return scope === null ? [] : affected(tx, scope, input);
  });
}

export interface BenchNoticeAlertDeps {
  db: Database | Transaction;
  /** `NotifyContext.enqueueDelivery`: sends one `notification.deliver` job. */
  enqueueDelivery: (job: DeliveryJob) => Promise<unknown>;
}

/**
 * Alert the members of each matched workspace to the notices that affect their listed matters, once
 * per member per notice (the notification `dedupeKey` makes a replay a no-op). Returns the number of
 * notifications sent; a failing notification never stops the others.
 */
export async function notifyBenchNoticeAlerts(
  deps: BenchNoticeAlertDeps,
  matches: readonly { workspaceId: string; noticeId: string }[],
): Promise<number> {
  let sent = 0;
  for (const { workspaceId, noticeId } of matches) {
    const audience = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
      const [org] = await tx
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, workspaceId));
      if (org === undefined) return undefined;
      const members = await tx
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, workspaceId), eq(member.status, 'active')))
        .orderBy(asc(member.userId));
      const readers: { userId: string; title: string; matterIds: string[] }[] = [];
      for (const m of members) {
        const scope = await readerScope(tx, workspaceId, m.userId);
        if (scope === null) continue;
        const alerts = await affected(tx, scope, { noticeId });
        const first = alerts[0];
        if (first === undefined) continue;
        readers.push({
          userId: m.userId,
          title: first.title,
          matterIds: alerts.map((a) => a.matterId),
        });
      }
      return { slug: org.slug, readers };
    });
    if (audience === undefined) continue;
    const ctx = { db: deps.db, workspaceId, enqueueDelivery: deps.enqueueDelivery };
    for (const reader of audience.readers) {
      const count = reader.matterIds.length;
      const only = reader.matterIds[0];
      try {
        await notify(ctx, {
          userId: reader.userId,
          category: 'bench_change',
          title: reader.title.slice(0, TITLE_MAX),
          body:
            count === 1
              ? 'A court notice may change the bench for 1 of your listed matters.'
              : `A court notice may change the bench for ${String(count)} of your listed matters.`,
          href:
            count === 1 && only !== undefined
              ? `/w/${audience.slug}/matters/${only}`
              : `/w/${audience.slug}/today`,
          dedupeKey: `bench-notice:${noticeId}`,
        });
        sent += 1;
      } catch {
        // One member's failed notification (e.g. a delivery enqueue error) must not stop the others.
      }
    }
  }
  return sent;
}
