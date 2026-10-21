// Courts read models (#397, for the courts area #42; ADR 0014, ADR 0015): the index of forums by
// city and court, a forum's detail (official deep links and the access-mode registry rows with
// counsel's notes), an adapter's status and the halls seen in a workspace's lists. Each runs in one
// `withWorkspace` transaction on the given workspace, so RLS limits `adapter_parse_run` and custom
// forums to it; the global tables (`adapter_version`, `access_mode_registry` and the tenant-free
// `adapter_health_summary` view) are read inside the same transaction. Read-only metadata: deep
// links come from `resolveDeepLink` and are never fetched, and no court hostname is written here.
// Adapter ids are matched exactly as stored: forum, registry and adapter ids are not mapped. The
// index also carries each forum's unreadable halls and official cause-list link for the courts
// page's parse-failure banner (#399).
//
// The rosters page read model (#434, part 1 of #391): each forum's roster versions with entry counts
// and the roster in force on a day, and the open bench-change alerts on matters the actor may read
// (matter title, the alert's roster start, and the old and new bench as the court publishes them).
// It checks membership and `matter.read` as the roster services do. A bench's judges are shown for
// that one bench only: nothing groups, counts or ranks by judge (PX-9, ME-6).
import { isRole } from '@causedeck/auth';
import { assertCan, ForbiddenError, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import { listAdapterAccessModes, type AccessMode } from '@causedeck/flags/access-mode';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Queryable,
  type Transaction,
} from '@causedeck/db';
import {
  FORUM_DEEP_LINK_KINDS,
  ForumConfigSchema,
  type ForumDeepLinkKind,
} from '@causedeck/validators/forum';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { forbidden, notFound, WorkspaceError } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import type { BenchChangeAlertRow } from './bench-change.ts';
import type { OpenInNewWindow } from './deep-links.ts';
import { getForum, listForums, resolveDeepLink, type Forum } from './forums.ts';
import type { BenchRosterRow, RosterActor } from './rosters.ts';

const {
  adapterHealthSummary,
  adapterParseRun,
  adapterVersion,
  bench,
  benchChangeAlert,
  benchRoster,
  benchRosterEntry,
  forum,
  matter,
  member,
  proceeding,
} = schema;

type AdapterLevel = Forum['adapterLevel'];
type ParseStatus = typeof adapterParseRun.$inferSelect.status;

export interface LatestParse {
  status: ParseStatus;
  at: Date;
  /** Halls the run could not read (the courts area's "Couldn't read today's list for Hall X"). */
  hallsUnreadable: string[];
}

export interface CourtsIndexForum {
  id: string;
  code: string;
  court: string;
  establishment: string | null;
  seat: string | null;
  side: Forum['side'];
  languageProfile: Forum['languageProfile'];
  adapterId: string | null;
  adapterLevel: AdapterLevel;
  /** A custom forum of this workspace rather than a catalogue one. */
  workspaceOwned: boolean;
  /** This workspace's newest parse run for the forum, or null when it has none. */
  latestParse: LatestParse | null;
  /** The forum's official cause-list page (new window), or null when it has no param-free one. */
  officialList: OpenInNewWindow | null;
}

/** A catalogued but disabled forum: its reason only, never a link, host or config. */
export interface DisabledForum {
  id: string;
  code: string;
  court: string;
  establishment: string | null;
  seat: string | null;
  reason: string | null;
}

export interface CourtsIndex {
  /** Enabled forums by city (`seat`, sorted; a forum without a seat is grouped last), then court. */
  cities: { city: string | null; courts: { court: string; forums: CourtsIndexForum[] }[] }[];
  disabled: DisabledForum[];
}

/**
 * The statement `getCourtsIndex` runs for each forum's newest parse run in the transaction's
 * workspace (RLS); exported for the plan and budget test.
 */
export function latestParseRunsStatement(tx: Transaction) {
  return tx
    .selectDistinctOn([adapterParseRun.forumCode], {
      forumCode: adapterParseRun.forumCode,
      status: adapterParseRun.status,
      at: adapterParseRun.createdAt,
      hallsUnreadable: adapterParseRun.hallsUnreadable,
    })
    .from(adapterParseRun)
    .orderBy(adapterParseRun.forumCode, desc(adapterParseRun.createdAt), desc(adapterParseRun.id));
}

/** Enabled forums by city then court, and the disabled ones apart with their reason and no links. */
export async function getCourtsIndex(db: Queryable, workspaceId: string): Promise<CourtsIndex> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const forums = await listForums(tx, workspaceId, { includeDisabled: true });
    const runs = await latestParseRunsStatement(tx);
    const latest = new Map(
      runs.map((run) => [
        run.forumCode,
        { status: run.status, at: run.at, hallsUnreadable: run.hallsUnreadable },
      ]),
    );

    const cities = new Map<string | null, Map<string, CourtsIndexForum[]>>();
    const disabled: DisabledForum[] = [];
    for (const f of forums) {
      if (!f.enabled) {
        const config = ForumConfigSchema.safeParse(f.config);
        disabled.push({
          id: f.id,
          code: f.code,
          court: f.court,
          establishment: f.establishment,
          seat: f.seat,
          reason: config.success ? (config.data.disabledReason ?? null) : null,
        });
        continue;
      }
      const courts = cities.get(f.seat) ?? new Map<string, CourtsIndexForum[]>();
      cities.set(f.seat, courts);
      const group = courts.get(f.court) ?? [];
      courts.set(f.court, group);
      group.push({
        id: f.id,
        code: f.code,
        court: f.court,
        establishment: f.establishment,
        seat: f.seat,
        side: f.side,
        languageProfile: f.languageProfile,
        adapterId: f.adapterId,
        adapterLevel: f.adapterLevel,
        workspaceOwned: f.workspaceId !== null,
        latestParse: latest.get(f.code) ?? null,
        officialList: deepLinkWithoutParams(f, 'cause_list'),
      });
    }
    return {
      cities: [...cities.entries()]
        .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
        .map(([city, courts]) => ({
          city,
          courts: [...courts.entries()].map(([court, group]) => ({ court, forums: group })),
        })),
      disabled,
    };
  });
}

export interface ForumDeepLink {
  kind: ForumDeepLinkKind;
  link: OpenInNewWindow;
  /** The court's page asks the lawyer to solve a captcha (`config.captchaGated`). */
  captchaGated: boolean;
}

export interface ForumAccessMode {
  resource: string;
  mode: AccessMode;
  enabled: boolean;
  counselNote: string | null;
  /** No counsel note yet: the courts area tags the row "Legal review pending". */
  legalReviewPending: boolean;
}

export interface ForumDetail {
  forum: Forum;
  /** New-window links to the forum's official pages that need no case details; none if disabled. */
  deepLinks: ForumDeepLink[];
  /** The registry rows of the forum's adapter (exact id); empty without an adapter. */
  accessModes: ForumAccessMode[];
}

/** A forum (catalogue or the workspace's own) with its deep links and access modes. */
export async function getForumDetail(
  db: Queryable,
  workspaceId: string,
  code: string,
): Promise<ForumDetail> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const forum = await getForum(tx, workspaceId, code);
    const config = ForumConfigSchema.safeParse(forum.config);
    const gated = new Set(config.success ? (config.data.captchaGated ?? []) : []);
    const deepLinks: ForumDeepLink[] = [];
    for (const kind of FORUM_DEEP_LINK_KINDS) {
      const link = deepLinkWithoutParams(forum, kind);
      if (link !== null) deepLinks.push({ kind, link, captchaGated: gated.has(kind) });
    }
    const rows = forum.adapterId === null ? [] : await listAdapterAccessModes(tx, forum.adapterId);
    return {
      forum,
      deepLinks,
      accessModes: rows.map((row) => ({
        resource: row.resource,
        mode: row.mode,
        enabled: row.enabled,
        counselNote: row.counselNote,
        legalReviewPending: (row.counselNote ?? '').trim() === '',
      })),
    };
  });
}

/** A template with `{name}` placeholders needs a case's details, which a forum page lacks. */
function deepLinkWithoutParams(forum: Forum, kind: ForumDeepLinkKind): OpenInNewWindow | null {
  try {
    return resolveDeepLink(forum, kind);
  } catch (error) {
    if (error instanceof WorkspaceError && error.code === 'VALIDATION') return null;
    throw error;
  }
}

export type AdapterHealth = 'ok' | 'degraded' | 'failed';

export interface AdapterLastParse {
  at: Date;
  status: ParseStatus;
  rowsParsed: number;
  rowsAnchored: number;
  hallsUnreadable: string[];
}

export interface AdapterStatus {
  adapterId: string;
  /** The `active` adapter_version, or null when none is active. */
  activeVersion: string | null;
  /** The highest level among the forums this workspace sees with this adapter. */
  level: AdapterLevel | null;
  /** Null until the version is verified against real lists. */
  lastVerifiedAt: Date | null;
  /** Every workspace's runs of the active version, as counts only; null with no runs. */
  health: AdapterHealth | null;
  /** This workspace's newest parse run of the adapter. */
  lastParse: AdapterLastParse | null;
}

/**
 * Health of the active version from its cumulative counts: failed when at least half the runs
 * failed, degraded when at least a tenth were not ok, so one old failure does not stick.
 */
function healthOf(counts: { runs: number; degradedRuns: number; failedRuns: number }) {
  if (counts.runs <= 0) return null;
  if (counts.failedRuns * 2 >= counts.runs) return 'failed';
  if ((counts.degradedRuns + counts.failedRuns) * 10 >= counts.runs) return 'degraded';
  return 'ok';
}

const LEVEL_ORDER: readonly AdapterLevel[] = ['A0', 'A1', 'A2', 'A3'];

/** An adapter's active version, level, verification, global health and this workspace's last parse. */
export async function getAdapterStatus(
  db: Queryable,
  workspaceId: string,
  adapterId: string,
): Promise<AdapterStatus> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const [active] = await tx
      .select({ version: adapterVersion.version, lastVerifiedAt: adapterVersion.lastVerifiedAt })
      .from(adapterVersion)
      .where(and(eq(adapterVersion.adapterId, adapterId), eq(adapterVersion.status, 'active')))
      .limit(1);
    const forums = await listForums(tx, workspaceId, { includeDisabled: true });
    const levels = forums.filter((f) => f.adapterId === adapterId).map((f) => f.adapterLevel);
    const level = LEVEL_ORDER.findLast((l) => levels.includes(l)) ?? null;
    const [summary] =
      active === undefined
        ? []
        : await tx
            .select()
            .from(adapterHealthSummary)
            .where(
              and(
                eq(adapterHealthSummary.adapterId, adapterId),
                eq(adapterHealthSummary.adapterVersion, active.version),
              ),
            )
            .limit(1);
    const [last] = await tx
      .select({
        at: adapterParseRun.createdAt,
        status: adapterParseRun.status,
        rowsParsed: adapterParseRun.rowsParsed,
        rowsAnchored: adapterParseRun.rowsAnchored,
        hallsUnreadable: adapterParseRun.hallsUnreadable,
      })
      .from(adapterParseRun)
      .where(eq(adapterParseRun.adapterId, adapterId))
      .orderBy(desc(adapterParseRun.createdAt), desc(adapterParseRun.id))
      .limit(1);
    return {
      adapterId,
      activeVersion: active?.version ?? null,
      level,
      lastVerifiedAt: active?.lastVerifiedAt ?? null,
      health: summary === undefined ? null : healthOf(summary),
      lastParse: last ?? null,
    };
  });
}

export interface HallSeen {
  hallNo: string;
  /** When the newest of this workspace's lists naming the hall was parsed. */
  lastListAt: Date;
  /** The hall could not be read in that newest list. */
  unreadable: boolean;
}

/** The statement `listHallsSeen` runs (exported for the plan and budget test). */
export function hallsSeenStatement(tx: Transaction, forumCode: string) {
  return tx
    .select({
      at: adapterParseRun.createdAt,
      hallsSeen: adapterParseRun.hallsSeen,
      hallsUnreadable: adapterParseRun.hallsUnreadable,
    })
    .from(adapterParseRun)
    .where(eq(adapterParseRun.forumCode, forumCode))
    .orderBy(desc(adapterParseRun.createdAt), desc(adapterParseRun.id));
}

/** Halls named in this workspace's parse runs for the forum, in natural order ('2' before '12A'). */
export async function listHallsSeen(
  db: Queryable,
  workspaceId: string,
  forumCode: string,
): Promise<HallSeen[]> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const runs = await hallsSeenStatement(tx, forumCode);
    const halls = new Map<string, HallSeen>();
    for (const run of runs) {
      const unreadable = new Set(run.hallsUnreadable);
      for (const hallNo of [...run.hallsSeen, ...run.hallsUnreadable]) {
        if (!halls.has(hallNo)) {
          halls.set(hallNo, { hallNo, lastListAt: run.at, unreadable: unreadable.has(hallNo) });
        }
      }
    }
    return [...halls.values()].sort((a, b) =>
      a.hallNo.localeCompare(b.hallNo, 'en', { numeric: true }),
    );
  });
}

export interface RosterSummary extends BenchRosterRow {
  /** The halls the version lists. */
  entryCount: number;
}

export interface RostersPageForum {
  forum: { id: string; code: string; court: string; seat: string | null };
  /** The forum's roster versions, newest start and version first. */
  rosters: RosterSummary[];
  /** The active or superseded roster in force on the asked day, or null when none covers it. */
  activeRosterId: string | null;
}

/** One bench as the court publishes it: never grouped, counted or ranked by judge. */
export interface BenchSummary {
  id: string;
  /** The judges joined for display ("Justice A, Justice B"), or null when none are recorded. */
  label: string | null;
  benchKind: (typeof bench.$inferSelect)['benchKind'];
  judges: string[];
}

export interface RostersPageAlert {
  alertId: string;
  proceedingId: string;
  matterId: string;
  matterTitle: string;
  forumId: string;
  rosterId: string;
  /** The new roster's first day (ISO date). */
  effectiveFrom: string;
  reason: BenchChangeAlertRow['reason'];
  createdAt: Date;
  /** Null when the proceeding had no bench under the previous roster. */
  oldBench: BenchSummary | null;
  newBench: BenchSummary;
}

export interface RostersPage {
  forums: RostersPageForum[];
  /** Open alerts on matters the actor may read, newest first. */
  alerts: RostersPageAlert[];
}

/** The user id owning the proceeding's matter, for a junior's "matters they own" visibility. */
const proceedingOwnerUserId = sql`(select ${member.userId} from ${matter} join ${member} on ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId} where ${matter.workspaceId} = ${proceeding.workspaceId} and ${matter.id} = ${proceeding.matterId})`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The statement `getRostersPage` runs for the workspace's rosters (exported for the budget test). */
export function rostersPageRostersStatement(tx: Transaction, workspaceId: string) {
  return tx
    .select()
    .from(benchRoster)
    .where(eq(benchRoster.workspaceId, workspaceId))
    .orderBy(asc(benchRoster.forumId), desc(benchRoster.effectiveFrom), desc(benchRoster.version));
}

/** The statement `getRostersPage` runs for entries per roster (exported for the budget test). */
export function rosterEntryCountsStatement(tx: Transaction, workspaceId: string) {
  return tx
    .select({ rosterId: benchRosterEntry.rosterId, entries: count() })
    .from(benchRosterEntry)
    .where(eq(benchRosterEntry.workspaceId, workspaceId))
    .groupBy(benchRosterEntry.rosterId);
}

/**
 * The statement `getRostersPage` runs for the open alerts on matters `actor` (role resolved) may
 * read, newest first (exported for the budget test).
 */
export function openBenchAlertsStatement(tx: Transaction, actor: Actor, settings: PolicySettings) {
  return tx
    .select({
      alert: benchChangeAlert,
      matterId: proceeding.matterId,
      matterTitle: matter.title,
      forumId: benchRoster.forumId,
      effectiveFrom: benchRoster.effectiveFrom,
    })
    .from(benchChangeAlert)
    .innerJoin(
      proceeding,
      and(
        eq(proceeding.workspaceId, benchChangeAlert.workspaceId),
        eq(proceeding.id, benchChangeAlert.proceedingId),
      ),
    )
    .innerJoin(
      matter,
      and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
    )
    .innerJoin(
      benchRoster,
      and(
        eq(benchRoster.workspaceId, benchChangeAlert.workspaceId),
        eq(benchRoster.id, benchChangeAlert.rosterId),
      ),
    )
    .where(
      and(
        eq(benchChangeAlert.workspaceId, actor.workspaceId),
        eq(benchChangeAlert.status, 'open'),
        matterVisibilityPredicate(actor, proceeding.matterId, {
          settings,
          ownerUserId: proceedingOwnerUserId,
        }),
      ),
    )
    .orderBy(desc(benchChangeAlert.createdAt), desc(benchChangeAlert.id));
}

/** Whether `a` is preferred to `b`: active before superseded, then the latest start and version. */
function preferred(a: BenchRosterRow, b: BenchRosterRow): boolean {
  if ((a.status === 'active') !== (b.status === 'active')) return a.status === 'active';
  if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom > b.effectiveFrom;
  return a.version > b.version;
}

/** The confirmed roster whose `[effective_from, effective_to)` contains `on` (as `getRosterAt`). */
function inForce(rosters: readonly BenchRosterRow[], on: string): BenchRosterRow | null {
  let best: BenchRosterRow | null = null;
  for (const r of rosters) {
    if (r.status !== 'active' && r.status !== 'superseded') continue;
    if (r.effectiveFrom > on || (r.effectiveTo !== null && r.effectiveTo <= on)) continue;
    if (best === null || preferred(r, best)) best = r;
  }
  return best;
}

/**
 * The courts rosters page: every forum the workspace has rosters for, with their versions, entry
 * counts and the roster in force on `on`, and the open bench-change alerts on matters the actor may
 * read. Requires `matter.read`; NOT_FOUND for a malformed id, a non-member or a call from another
 * workspace's scope, VALIDATION for a malformed day.
 */
export async function getRostersPage(
  db: Queryable,
  actor: RosterActor,
  input: { on: string },
): Promise<RostersPage> {
  const { workspaceId, userId } = actor;
  const pageNotFound = () => notFound('Workspace not found');
  if (!isUuid(workspaceId) || !isUuid(userId)) throw pageNotFound();
  if (!DAY.test(input.on)) throw new WorkspaceError('VALIDATION', 'Give the day as YYYY-MM-DD');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
  ) {
    throw pageNotFound();
  }
  return withWorkspace(db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw pageNotFound();
    const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
    const resolved: Actor = { ...actor, role };
    try {
      assertCan(resolved, 'matter.read', { kind: 'roster', workspaceId }, { settings });
    } catch (error) {
      if (error instanceof ForbiddenError) throw forbidden('You cannot see the rosters');
      throw error;
    }

    const rosters = await rostersPageRostersStatement(tx, workspaceId);
    const counts = await rosterEntryCountsStatement(tx, workspaceId);
    const entryCount = new Map(counts.map((c) => [c.rosterId, c.entries]));
    const forumIds = [...new Set(rosters.map((r) => r.forumId))];
    const forums =
      forumIds.length === 0
        ? []
        : await tx
            .select({ id: forum.id, code: forum.code, court: forum.court, seat: forum.seat })
            .from(forum)
            .where(inArray(forum.id, forumIds))
            .orderBy(asc(forum.court), asc(forum.code));
    const pageForums = forums.map((f) => {
      const own = rosters.filter((r) => r.forumId === f.id);
      return {
        forum: f,
        rosters: own.map((r) => ({ ...r, entryCount: entryCount.get(r.id) ?? 0 })),
        activeRosterId: inForce(own, input.on)?.id ?? null,
      };
    });

    const rows = await openBenchAlertsStatement(tx, resolved, settings);
    const benchIds = [
      ...new Set(
        rows.flatMap((r) =>
          r.alert.oldBenchId === null
            ? [r.alert.newBenchId]
            : [r.alert.oldBenchId, r.alert.newBenchId],
        ),
      ),
    ];
    const benches =
      benchIds.length === 0
        ? []
        : await tx
            .select({ id: bench.id, benchKind: bench.benchKind, judges: bench.judges })
            .from(bench)
            .where(inArray(bench.id, benchIds));
    const benchOf = new Map(
      benches.map((b): [string, BenchSummary] => [
        b.id,
        { ...b, label: b.judges.length === 0 ? null : b.judges.join(', ') },
      ]),
    );
    const unknownBench = (id: string): BenchSummary => ({
      id,
      label: null,
      benchKind: 'other',
      judges: [],
    });
    const alerts = rows.map((r): RostersPageAlert => ({
      alertId: r.alert.id,
      proceedingId: r.alert.proceedingId,
      matterId: r.matterId,
      matterTitle: r.matterTitle,
      forumId: r.forumId,
      rosterId: r.alert.rosterId,
      effectiveFrom: r.effectiveFrom,
      reason: r.alert.reason,
      createdAt: r.alert.createdAt,
      oldBench:
        r.alert.oldBenchId === null
          ? null
          : (benchOf.get(r.alert.oldBenchId) ?? unknownBench(r.alert.oldBenchId)),
      newBench: benchOf.get(r.alert.newBenchId) ?? unknownBench(r.alert.newBenchId),
    }));
    return { forums: pageForums, alerts };
  });
}
