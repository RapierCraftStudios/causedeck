// Court-day display-board tracking (#493, D-048). `pollBoards` fetches each High Court's display
// board once per run through the governed fetch layer (however many workspaces list a matter in a
// hall), only during court hours and only for halls where a workspace has an advocate listed today
// (`app_board_poll_targets`, 0074, owner-defined: ids and keys only). Each changed hall is stored as
// a content-free `board_observation` (the pace history) and the matter owner is told through
// `notify()` (category `court.board`) once per threshold: N away, now, risen, passed over. The
// dedupe key `board:<listing>:<kind>` makes a repeat poll notify nobody. Titles carry hall and item
// numbers only: never a party, case number or advocate. Nothing is fetched while the flag
// `court.live-tracking` is off or the source is uncleared. Counts only are logged. Core never
// imports `@causedeck/fetch`: the worker wires the governed fetcher through its `BoardFetcher` shape.
import {
  parseKarnatakaDisplayBoard,
  parseMadrasDisplayBoard,
  type DisplayBoardRow,
  type ParsedDisplayBoard,
} from '@causedeck/adapters';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { isEnabled } from '@causedeck/flags';
import { COURT_HOURS, notify, type NotifyContext } from '@causedeck/notifications';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';

import { policyFor, SourceNotCleared } from '../sources/index.ts';

import {
  estimateCallWindow,
  itemNumber,
  paceSamples,
  type CallWindow,
  type PaceObservation,
} from './eta.ts';

const { boardObservation, courtHall, forum, listing, matter, member, proceeding } = schema;

export const COURT_LIVE_TRACKING_FLAG = 'court.live-tracking';

export interface BoardSource {
  sourceId: string;
  /** The forum codes this board covers start with this prefix. */
  forumPrefix: string;
  /** The board page under the source's `base_url`. */
  path: string;
  parse: (html: string) => ParsedDisplayBoard;
}

export const BOARD_SOURCES: readonly BoardSource[] = [
  {
    sourceId: 'in.tn.madras-hc.chennai:display_board',
    forumPrefix: 'in.tn.madras-hc.',
    path: 'displayboard',
    parse: parseMadrasDisplayBoard,
  },
  {
    sourceId: 'in.ka.karnataka-hc.bengaluru:display_board',
    forumPrefix: 'in.ka.karnataka-hc.',
    path: 'displayboard',
    parse: parseKarnatakaDisplayBoard,
  },
];

/** Away-thresholds that alert by default (5 away, 2 away); "now", risen and passed over always do. */
export const DEFAULT_AWAY_THRESHOLDS: readonly number[] = [5, 2];

type Db = Database | Transaction;

const boardForForum = (forumCode: string) =>
  BOARD_SOURCES.find((b) => forumCode.startsWith(b.forumPrefix));

const istDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);

/** Mon-Fri, 10:30-17:00 in `Asia/Kolkata` (the notification court hours). */
export function isCourtHours(at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  if (get('weekday') === 'Sat' || get('weekday') === 'Sun') return false;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  return minutes >= toMinutes(COURT_HOURS.start) && minutes < toMinutes(COURT_HOURS.end);
}

export interface BoardAlert {
  /** The dedupe kind: a threshold (`5`, `2`), `now`, `risen` or `passed_over`. */
  kind: string;
  title: string;
}

/**
 * The one alert a listed item earns from its hall's board now, or null. Passed over beats risen
 * beats the tightest crossed away-threshold; an item already behind the board earns none.
 */
export function planBoardAlert(
  target: { itemNo: string },
  row: DisplayBoardRow,
  thresholds: readonly number[] = DEFAULT_AWAY_THRESHOLDS,
): BoardAlert | null {
  const mine = itemNumber(target.itemNo);
  if (mine === null) return null;
  const label = `item ${target.itemNo} in Hall ${row.hallNo}`;
  if (row.passedOver.some((item) => itemNumber(item) === mine)) {
    return { kind: 'passed_over', title: `Your ${label} was passed over` };
  }
  const now = itemNumber(row.itemNow);
  if (row.status === 'risen') {
    return now === null || mine >= now
      ? { kind: 'risen', title: `Hall ${row.hallNo} has risen before your item ${target.itemNo}` }
      : null;
  }
  if (row.status !== 'sitting' || now === null) return null;
  const away = mine - now;
  if (away < 0) return null;
  if (away === 0) return { kind: 'now', title: `Your ${label} is being heard now` };
  const crossed = [...thresholds].sort((a, b) => a - b).find((t) => away <= t);
  return crossed === undefined
    ? null
    : { kind: String(crossed), title: `Your ${label} is ${String(away)} away` };
}

/** Structurally the `Fetcher` of `@causedeck/fetch`, which this module does not import. */
export interface BoardFetcher {
  fetchSource(sourceId: string, url: string): Promise<{ body: string }>;
}

export interface PollBoardsDeps {
  db: Db;
  fetcher: BoardFetcher;
  /** Sends one `notification.deliver` job (`NotifyContext.enqueueDelivery`). */
  enqueueDelivery: NotifyContext['enqueueDelivery'];
  clock?: { now(): Date };
  /** Whether the flag is on for the workspace; defaults to the flag service. */
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
  /** The source's policy; throws `SourceNotCleared` when it may not be fetched. Defaults to the registry. */
  policy?: (sourceId: string) => Promise<{ baseUrl: string }>;
  /** Away-thresholds to alert at; defaults to 5 and 2. */
  awayThresholds?: readonly number[];
  /** Counts only: never row content. */
  log?: (event: string, counts: Record<string, number>) => void;
}

export interface PollBoardsReport {
  outcome: 'ok' | 'outside_court_hours' | 'no_targets' | 'flag_off' | 'source_not_cleared';
  /** Provider calls made: at most one per board. */
  fetched: number;
  /** Hall changes stored. */
  observed: number;
  /** Alerts handed to `notify()` (a repeat is dropped there by its dedupe key). */
  alerts: number;
}

interface TargetRow {
  workspace_id: string;
  listing_id: string;
  proceeding_id: string;
  owner_user_id: string;
  slug: string;
  forum_code: string;
  hall_no: string;
  item_no: string;
}

const sameState = (
  last: { itemNo: string | null; status: string; passedOver: string[] },
  row: DisplayBoardRow,
) =>
  last.itemNo === row.itemNow &&
  last.status === row.status &&
  last.passedOver.join(',') === row.passedOver.join(',');

/** Fetch each board once, store changed halls and alert the matter owners. Never throws for a closed gate. */
export async function pollBoards(deps: PollBoardsDeps): Promise<PollBoardsReport> {
  const now = deps.clock?.now() ?? new Date();
  const log = deps.log ?? (() => undefined);
  const report: PollBoardsReport = { outcome: 'ok', fetched: 0, observed: 0, alerts: 0 };
  if (!isCourtHours(now)) return { ...report, outcome: 'outside_court_hours' };

  const rows = await deps.db.execute<TargetRow>(
    sql`select workspace_id::text, listing_id::text, proceeding_id::text, owner_user_id::text, slug, forum_code, hall_no, item_no from app_board_poll_targets(${istDate(now)}::date)`,
  );
  if (rows.length === 0) return { ...report, outcome: 'no_targets' };

  const flag =
    deps.flagEnabled ?? ((workspaceId) => isEnabled(COURT_LIVE_TRACKING_FLAG, { workspaceId }));
  const enabled = new Map<string, boolean>();
  const targets: TargetRow[] = [];
  for (const row of rows) {
    let on = enabled.get(row.workspace_id);
    if (on === undefined) {
      on = await flag(row.workspace_id);
      enabled.set(row.workspace_id, on);
    }
    if (on) targets.push(row);
  }
  if (targets.length === 0) return { ...report, outcome: 'flag_off' };

  const policy = deps.policy ?? ((id: string) => policyFor(id, { db: deps.db }));
  const thresholds = deps.awayThresholds ?? DEFAULT_AWAY_THRESHOLDS;
  let notCleared = 0;
  let boards = 0;
  for (const board of BOARD_SOURCES) {
    const mine = targets.filter((t) => boardForForum(t.forum_code) === board);
    if (mine.length === 0) continue;
    boards += 1;
    let baseUrl: string;
    try {
      baseUrl = (await policy(board.sourceId)).baseUrl;
    } catch (error) {
      if (error instanceof SourceNotCleared) {
        notCleared += 1;
        continue;
      }
      throw error;
    }

    const fetched = await deps.fetcher.fetchSource(
      board.sourceId,
      new URL(board.path, baseUrl).toString(),
    );
    report.fetched += 1;
    const parsed = board.parse(fetched.body);
    // `fetched.body` goes out of scope here: only hall, item and state are ever stored.
    if (parsed.status !== 'ok') {
      log('board.unreadable', { rows: parsed.rows.length });
      continue;
    }
    const wanted = new Set(mine.map((t) => t.hall_no));
    const byHall = new Map(
      parsed.rows.filter((r) => wanted.has(r.hallNo)).map((r) => [r.hallNo, r]),
    );

    const recent = await deps.db
      .select()
      .from(boardObservation)
      .where(
        and(
          eq(boardObservation.sourceId, board.sourceId),
          inArray(boardObservation.hallNo, [...byHall.keys()]),
          gte(boardObservation.observedAt, new Date(now.getTime() - 24 * 3_600_000)),
        ),
      )
      .orderBy(desc(boardObservation.observedAt));
    const last = new Map<string, (typeof recent)[number]>();
    for (const obs of recent) if (!last.has(obs.hallNo)) last.set(obs.hallNo, obs);
    const changed = [...byHall.values()].filter((row) => {
      const before = last.get(row.hallNo);
      return before === undefined || !sameState(before, row);
    });
    if (changed.length > 0) {
      await deps.db.insert(boardObservation).values(
        changed.map((row) => ({
          sourceId: board.sourceId,
          hallNo: row.hallNo,
          itemNo: row.itemNow,
          status: row.status,
          passedOver: row.passedOver,
          observedAt: now,
        })),
      );
      report.observed += changed.length;
    }

    for (const target of mine) {
      const row = byHall.get(target.hall_no);
      if (row === undefined) continue;
      const alert = planBoardAlert({ itemNo: target.item_no }, row, thresholds);
      if (alert === null) continue;
      report.alerts += 1;
      try {
        await notify(
          {
            db: deps.db,
            workspaceId: target.workspace_id,
            enqueueDelivery: deps.enqueueDelivery,
          },
          {
            userId: target.owner_user_id,
            category: 'court.board',
            title: alert.title,
            href: `/w/${target.slug}/today`,
            dedupeKey: `board:${target.listing_id}:${alert.kind}`,
          },
        );
      } catch {
        // One undeliverable member must not stop the other halls; the next poll retries.
        report.alerts -= 1;
      }
    }
  }
  if (boards > 0 && notCleared === boards) return { ...report, outcome: 'source_not_cleared' };
  log('board.poll', { fetched: report.fetched, observed: report.observed, alerts: report.alerts });
  return report;
}

// --- the live halls read model -----------------------------------------------------------------

export interface LiveHallItem {
  listingId: string;
  matterId: string;
  itemNo: string;
  /** Items between the board and this item; null when the board shows no item. */
  itemsAway: number | null;
  window: CallWindow | null;
}

export interface LiveHall {
  forumCode: string;
  hallNo: string;
  itemNow: string | null;
  status: PaceObservation['status'] | null;
  observedAt: Date | null;
  items: LiveHallItem[];
}

export interface LiveHallsDeps {
  db: Db;
  clock?: { now(): Date };
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
}

/** Today's halls where the member has an item listed, with the board's latest state and the estimate. */
export async function getLiveHalls(
  deps: LiveHallsDeps,
  actor: { workspaceId: string; userId: string },
): Promise<LiveHall[]> {
  const now = deps.clock?.now() ?? new Date();
  const flag =
    deps.flagEnabled ?? ((id) => isEnabled(COURT_LIVE_TRACKING_FLAG, { workspaceId: id }));
  if (!(await flag(actor.workspaceId))) return [];

  const mine = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({
        listingId: listing.id,
        matterId: matter.id,
        itemNo: listing.itemNo,
        hallNo: courtHall.hallNo,
        forumCode: forum.code,
      })
      .from(listing)
      .innerJoin(courtHall, eq(courtHall.id, listing.hallId))
      .innerJoin(forum, eq(forum.id, courtHall.forumId))
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
      .innerJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .where(
        and(
          eq(listing.workspaceId, actor.workspaceId),
          eq(listing.listDate, istDate(now)),
          eq(member.userId, actor.userId),
          ne(proceeding.state, 'disposed'),
        ),
      ),
  );

  const halls = new Map<string, LiveHall & { sourceId: string }>();
  for (const row of mine) {
    const board = boardForForum(row.forumCode);
    if (board === undefined || row.itemNo === null) continue;
    const key = `${board.sourceId}|${row.hallNo}`;
    const hall = halls.get(key) ?? {
      sourceId: board.sourceId,
      forumCode: row.forumCode,
      hallNo: row.hallNo,
      itemNow: null,
      status: null,
      observedAt: null,
      items: [],
    };
    hall.items.push({
      listingId: row.listingId,
      matterId: row.matterId,
      itemNo: row.itemNo,
      itemsAway: null,
      window: null,
    });
    halls.set(key, hall);
  }

  const since = new Date(now.getTime() - 30 * 24 * 3_600_000);
  for (const hall of halls.values()) {
    const history = await deps.db
      .select()
      .from(boardObservation)
      .where(
        and(
          eq(boardObservation.sourceId, hall.sourceId),
          eq(boardObservation.hallNo, hall.hallNo),
          gte(boardObservation.observedAt, since),
        ),
      )
      .orderBy(boardObservation.observedAt);
    const latest = history[history.length - 1];
    if (latest !== undefined && istDate(latest.observedAt) === istDate(now)) {
      hall.itemNow = latest.itemNo;
      hall.status = latest.status;
      hall.observedAt = latest.observedAt;
    }
    const samples = paceSamples(history);
    const current = itemNumber(hall.itemNow);
    for (const item of hall.items) {
      const mineNo = itemNumber(item.itemNo);
      if (current === null || mineNo === null) continue;
      item.itemsAway = Math.max(0, mineNo - current);
      item.window = estimateCallWindow({ itemsAhead: item.itemsAway, samples, now });
    }
    hall.items.sort((a, b) => (itemNumber(a.itemNo) ?? 0) - (itemNumber(b.itemNo) ?? 0));
  }
  return [...halls.values()]
    .sort((a, b) => a.hallNo.localeCompare(b.hallNo, undefined, { numeric: true }))
    .map((hall) => ({
      forumCode: hall.forumCode,
      hallNo: hall.hallNo,
      itemNow: hall.itemNow,
      status: hall.status,
      observedAt: hall.observedAt,
      items: hall.items,
    }));
}
