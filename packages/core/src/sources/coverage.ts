// The staff coverage model (#517, D-049): which forums of the catalogue are read, for which data
// type, at which access level, how fresh and how much, and where the biggest gaps are. It joins
// the forum catalogue, the source registry, the content-free `fetch_log` and `notice`, and the
// per-source watch demand from `app_staff_watch_demand` (counts only). Everything here is ids,
// levels, counts and times: no URL, document, party or user data.
import { schema, withUser, type Queryable } from '@causedeck/db';
import { and, eq, isNull, max, sql } from 'drizzle-orm';

import { SourceAdminError } from './registry.ts';

const { fetchLog, forum, notice, source } = schema;

const DAY_MS = 86_400_000;

/** The data types the tracker shows, in column order. */
export const COVERAGE_DATA_TYPES = [
  'cause_list',
  'case_status',
  'order',
  'display_board',
  'notice',
] as const;
export type CoverageDataType = (typeof COVERAGE_DATA_TYPES)[number];

/** `none`: no cleared source reads this data type for the forum. */
export const COVERAGE_LEVELS = ['none', 'A0', 'A1', 'A2', 'A3'] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

const levelIndex = (level: CoverageLevel): number => COVERAGE_LEVELS.indexOf(level);
const TOP_LEVEL = COVERAGE_LEVELS.length - 1;

export interface CoverageForum {
  code: string;
  court: string;
  establishment: string | null;
  jurisdictionKind: string;
}

export interface CoverageSource {
  id: string;
  kind: string;
  accessMode: Exclude<CoverageLevel, 'none'>;
  clearedAt: Date | null;
  killSwitch: boolean;
}

/** Successful fetches of one source: the latest, and how many in the last 7 days. */
export interface CoverageFetch {
  sourceId: string;
  lastSuccessAt: Date | null;
  successes7d: number;
}

/** Notices of one source that name one forum code. */
export interface CoverageNotice {
  sourceId: string;
  forumCode: string;
  latestAt: Date | null;
  count7d: number;
}

/** Live watch counts of one source (`app_staff_watch_demand`). */
export interface WatchDemand {
  sourceId: string;
  watches: number;
  users: number;
}

export interface CoverageInputs {
  forums: readonly CoverageForum[];
  sources: readonly CoverageSource[];
  fetches: readonly CoverageFetch[];
  notices: readonly CoverageNotice[];
  demand: readonly WatchDemand[];
}

export interface CoverageCell {
  dataType: CoverageDataType;
  level: CoverageLevel;
  /** Every registered source that covers the cell, cleared or not. */
  sourceIds: string[];
  lastFetchedAt: Date | null;
  volume7d: number;
  watches: number;
  users: number;
}

export interface ForumCoverage {
  forum: CoverageForum;
  /** The state code: the second segment of the forum code (`in.ka.…` is `ka`). */
  state: string;
  cells: Record<CoverageDataType, CoverageCell>;
}

export interface CoverageGap {
  forumCode: string;
  dataType: CoverageDataType;
  level: CoverageLevel;
  watches: number;
  users: number;
  /** `(watches + users) × missing levels`; missing is the distance from the cell's level to A3. */
  score: number;
}

/** The state segment of a forum code, or `''` when it has none. */
export function forumState(code: string): string {
  return code.split('.')[1] ?? '';
}

/**
 * Whether `sourceId` (`<prefix>:<type>`) reads `forum` for `type`: the prefix is the forum code, a
 * dotted ancestor of it, or `in.<st>.district` for a district forum of state `<st>`.
 */
export function sourceCoversForum(
  sourceId: string,
  forumRow: Pick<CoverageForum, 'code' | 'jurisdictionKind'>,
  type: CoverageDataType,
): boolean {
  const suffix = `:${type}`;
  if (!sourceId.endsWith(suffix)) return false;
  const prefix = sourceId.slice(0, -suffix.length);
  if (prefix === forumRow.code || forumRow.code.startsWith(`${prefix}.`)) return true;
  return (
    forumRow.jurisdictionKind === 'district' &&
    prefix === `in.${forumState(forumRow.code)}.district`
  );
}

function bestLevel(sources: readonly CoverageSource[], asOf: Date | undefined): CoverageLevel {
  let best: CoverageLevel = 'none';
  for (const s of sources) {
    if (s.clearedAt === null || s.killSwitch) continue;
    if (asOf !== undefined && s.clearedAt > asOf) continue;
    if (levelIndex(s.accessMode) > levelIndex(best)) best = s.accessMode;
  }
  return best;
}

const later = (a: Date | null, b: Date | null): Date | null =>
  a === null ? b : b === null || a >= b ? a : b;

/**
 * Every forum of `inputs.forums` with one cell per data type. With `asOf`, sources cleared after it
 * are ignored, which is how last week's levels are derived: a kill switch or access mode edit is
 * not historical, so a change of those is not reported as a change.
 */
export function buildCoverage(inputs: CoverageInputs, asOf?: Date): ForumCoverage[] {
  const fetchBy = new Map(inputs.fetches.map((f) => [f.sourceId, f]));
  const demandBy = new Map(inputs.demand.map((d) => [d.sourceId, d]));
  const sourceBy = new Map(inputs.sources.map((s) => [s.id, s]));
  return [...inputs.forums]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((f) => {
      const cells = {} as Record<CoverageDataType, CoverageCell>;
      for (const type of COVERAGE_DATA_TYPES) {
        const noticeRows =
          type === 'notice' ? inputs.notices.filter((n) => n.forumCode === f.code) : [];
        const covering =
          type === 'notice'
            ? noticeRows.flatMap((n) => sourceBy.get(n.sourceId) ?? [])
            : inputs.sources.filter((s) => sourceCoversForum(s.id, f, type));
        let lastFetchedAt: Date | null = null;
        let volume7d = 0;
        let watches = 0;
        let users = 0;
        if (type === 'notice') {
          for (const n of noticeRows) {
            lastFetchedAt = later(lastFetchedAt, n.latestAt);
            volume7d += n.count7d;
          }
        }
        for (const s of covering) {
          if (type !== 'notice') {
            const fetched = fetchBy.get(s.id);
            lastFetchedAt = later(lastFetchedAt, fetched?.lastSuccessAt ?? null);
            volume7d += fetched?.successes7d ?? 0;
          }
          const d = demandBy.get(s.id);
          watches += d?.watches ?? 0;
          users += d?.users ?? 0;
        }
        cells[type] = {
          dataType: type,
          level: bestLevel(covering, asOf),
          sourceIds: [...new Set(covering.map((s) => s.id))].sort(),
          lastFetchedAt,
          volume7d,
          watches,
          users,
        };
      }
      return { forum: f, state: forumState(f.code), cells };
    });
}

/**
 * The gap list: every cell below A3, ranked by live demand (watches and users on the sources that
 * cover it) times the levels missing, highest first. Users are summed per source, so a user who
 * watches two sources counts twice; a state-wide source's demand shows on each forum it covers.
 */
export function rankGaps(coverage: readonly ForumCoverage[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const row of coverage) {
    for (const type of COVERAGE_DATA_TYPES) {
      const cell = row.cells[type];
      const missing = TOP_LEVEL - levelIndex(cell.level);
      if (missing <= 0) continue;
      gaps.push({
        forumCode: row.forum.code,
        dataType: type,
        level: cell.level,
        watches: cell.watches,
        users: cell.users,
        score: (cell.watches + cell.users) * missing,
      });
    }
  }
  return gaps.sort(
    (a, b) =>
      b.score - a.score ||
      levelIndex(a.level) - levelIndex(b.level) ||
      a.forumCode.localeCompare(b.forumCode) ||
      COVERAGE_DATA_TYPES.indexOf(a.dataType) - COVERAGE_DATA_TYPES.indexOf(b.dataType),
  );
}

export interface CoverageChange {
  forumCode: string;
  dataType: CoverageDataType;
  from: CoverageLevel;
  to: CoverageLevel;
}

/** The cells whose level differs between two coverage views of the same catalogue. */
export function diffCoverage(
  before: readonly ForumCoverage[],
  after: readonly ForumCoverage[],
): CoverageChange[] {
  const prev = new Map(before.map((r) => [r.forum.code, r]));
  const changes: CoverageChange[] = [];
  for (const row of after) {
    for (const type of COVERAGE_DATA_TYPES) {
      const from = prev.get(row.forum.code)?.cells[type].level ?? 'none';
      const to = row.cells[type].level;
      if (from !== to) changes.push({ forumCode: row.forum.code, dataType: type, from, to });
    }
  }
  return changes;
}

/**
 * The catalogue, source, fetch and notice inputs, from the global tables `forum` (system catalogue
 * rows, by its `global_read` policy), `source`, `fetch_log` and `notice` only.
 */
export async function readCatalogueCoverageInputs(
  db: Queryable,
  now: Date,
): Promise<Omit<CoverageInputs, 'demand'>> {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const forums = await db
    .select({
      code: forum.code,
      court: forum.court,
      establishment: forum.establishment,
      jurisdictionKind: forum.jurisdictionKind,
    })
    .from(forum)
    .where(and(isNull(forum.workspaceId), eq(forum.enabled, true)))
    .orderBy(forum.code);
  const sources = await db
    .select({
      id: source.id,
      kind: source.kind,
      accessMode: source.accessMode,
      clearedAt: source.clearedAt,
      killSwitch: source.killSwitch,
    })
    .from(source)
    .orderBy(source.id);
  const ok = sql`${fetchLog.status} >= 200 and ${fetchLog.status} < 400`;
  const fetches = await db
    .select({
      sourceId: fetchLog.sourceId,
      lastSuccessAt: max(fetchLog.fetchedAt),
      successes7d: sql<number>`(count(*) filter (where ${fetchLog.fetchedAt} >= ${since7.toISOString()}::timestamptz))::int`,
    })
    .from(fetchLog)
    .where(ok)
    .groupBy(fetchLog.sourceId);
  const code = sql<string>`unnest(${notice.forumCodes})`;
  const noticeRows = await db
    .select({
      sourceId: notice.sourceId,
      forumCode: code,
      latestAt: max(notice.createdAt),
      count7d: sql<number>`(count(*) filter (where ${notice.createdAt} >= ${since7.toISOString()}::timestamptz))::int`,
    })
    .from(notice)
    .groupBy(notice.sourceId, sql`2`);
  return { forums, sources, fetches, notices: noticeRows };
}

/**
 * All coverage inputs for a staff member in one user-scoped transaction. `forum` is not an
 * allow-listed global table for `withoutWorkspace`, so the read runs as the staff user, and the
 * watch demand comes from `app_staff_watch_demand`, which refuses anyone but an enabled staff_user.
 */
export async function staffCoverageInputs(
  db: Queryable,
  staffUserId: string,
  now: Date,
): Promise<CoverageInputs> {
  try {
    return await withUser(db, { userId: staffUserId }, async (tx) => {
      const base = await readCatalogueCoverageInputs(tx, now);
      const rows = await tx.execute<{ source_id: string; watches: string; users: string }>(
        sql`select * from app_staff_watch_demand()`,
      );
      const demand = rows.map((r) => ({
        sourceId: r.source_id,
        watches: Number(r.watches),
        users: Number(r.users),
      }));
      return { ...base, demand };
    });
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code;
    const causeCode = (error as { cause?: { code?: string } }).cause?.code;
    if (code === '42501' || causeCode === '42501') {
      throw new SourceAdminError('FORBIDDEN', 'Only enabled staff can read the coverage tracker');
    }
    throw error;
  }
}

/** The coverage view, its gap list and the level changes since a week before `now`. */
export function coverageReport(inputs: CoverageInputs, now: Date) {
  const coverage = buildCoverage(inputs);
  const lastWeek = buildCoverage(inputs, new Date(now.getTime() - 7 * DAY_MS));
  return { coverage, gaps: rankGaps(coverage), changes: diffCoverage(lastWeek, coverage) };
}
