// Court-day board fixtures (#59): one chamber day seeded relative to the real IST date, because the
// board reads "today" and "tomorrow" on the server. Written into the worker database (owner role,
// one transaction scoped to `chennai-solo`, as `withWorkspace` would) before the page opens.
//
// The day, for the `chennai-solo` workspace (everything fictional):
//   Forum A (Madras HC appellate side)   Hall 3: items 1, 9, 10, 12, 14, 20     Hall 7: items 5, 22
//   Forum B (Madras HC original side)    Hall 1: item 9; its newest list read left Hall 12 unreadable
//   - items 14 (Hall 3) and 22 (Hall 7) are both the owner's: a clash;
//   - the latest list change moved item 14 from Hall 4, added item 10 and removed item 12;
//   - item 14 is a `WP(MD)` case, item 5 a Tamil and item 9 (Hall 1) a Kannada party name;
//   - item 14 was listed yesterday too (carry list) and item 22 awaits confirmation (needs you);
//   - item 20 is a restricted matter only the owner may read; item 9 (Hall 3) is shared with the
//     clerk and the viewer; tomorrow holds one item in Hall 3.
import postgres from 'postgres';

import { databaseUrl } from '../support/db-reset.ts';

import { COURTS_WORKSPACE_ID, DEGRADED_FORUM, HALLS_FORUM } from './courts-data.ts';
import type { WorkerDb } from './db.ts';
import { e2eUser, type E2eRole } from './workspace.ts';

const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

/** `YYYY-MM-DD` in IST, `offsetDays` after now: the days the board shows. */
export function istDate(offsetDays = 0): string {
  return istDay.format(new Date(Date.now() + offsetDays * 86_400_000));
}

const id = (n: number) =>
  `00000000-0000-4000-8000-${(0xe5900000 + n).toString(16).padStart(12, '0')}`;

export const COURT_DAY = {
  /** Case numbers as the board prints them. */
  moved: 'WP(MD) 20001/2026',
  added: 'WP 4001/2026',
  removed: 'WP 5005/2025',
  first: 'WP 12345/2026',
  clashA: 'WP(MD) 20001/2026',
  clashB: 'WA 777/2025',
  restrictedTitle: 'Restricted fictional matter',
  tamilParty: 'முருகன் எதிர் மாநில அரசு',
  kannadaParty: 'ರಾಮಯ್ಯ ವಿರುದ್ಧ ಕರ್ನಾಟಕ ರಾಜ್ಯ',
  sharedTitle: 'Shared v. Chamber (fictional)',
  judge: 'Justice Test One',
} as const;

interface Row {
  n: number;
  forum: 'A' | 'B';
  hall: string;
  item: string;
  day: 0 | 1;
  type: string;
  number: string;
  year: number;
  title: string;
  stageRaw: string;
  stageNorm: string | null;
  appear: readonly E2eRole[];
  restricted?: true;
  bench?: boolean;
}

const ROWS: readonly Row[] = [
  row(
    1,
    'A',
    '3',
    '1',
    'WP',
    '12345',
    2026,
    'Rajan v. State rep. by the Secretary',
    'FOR ADMISSION',
    'numbered',
    [],
    false,
    true,
  ),
  row(
    2,
    'A',
    '3',
    '14',
    'WP(MD)',
    '20001',
    2026,
    'Anand v. Union of India',
    'PART HEARD',
    'part-heard',
    ['owner'],
  ),
  row(
    3,
    'A',
    '7',
    '22',
    'WA',
    '777',
    2025,
    'Kavitha v. Commissioner of Police',
    'FOR ORDERS',
    'listed',
    ['owner'],
  ),
  row(4, 'A', '7', '5', 'WP', '8100', 2026, COURT_DAY.tamilParty, 'FOR ADMISSION', 'numbered', []),
  row(
    5,
    'B',
    '1',
    '9',
    'WP',
    '3300',
    2026,
    COURT_DAY.kannadaParty,
    'FOR ADMISSION',
    'numbered',
    [],
  ),
  row(
    6,
    'A',
    '3',
    '20',
    'WP',
    '9999',
    2026,
    COURT_DAY.restrictedTitle,
    'FOR ORDERS',
    'listed',
    ['viewer'],
    true,
  ),
  row(7, 'A', '3', '9', 'WP', '6100', 2026, COURT_DAY.sharedTitle, 'FOR HEARING', 'listed', [
    'clerk',
    'viewer',
  ]),
  row(
    8,
    'A',
    '3',
    '10',
    'WP',
    '4001',
    2026,
    'Added v. Supplementary (fictional)',
    'FOR ADMISSION',
    'numbered',
    [],
  ),
  row(
    9,
    'A',
    '3',
    '12',
    'WP',
    '5005',
    2025,
    'Removed v. Supplementary (fictional)',
    'FOR ORDERS',
    'listed',
    [],
  ),
  row(
    10,
    'A',
    '3',
    '2',
    'WP',
    '7001',
    2026,
    'Tomorrow v. State (fictional)',
    'FOR ADMISSION',
    'numbered',
    [],
    false,
    false,
    1,
  ),
];

function row(
  n: number,
  forum: 'A' | 'B',
  hall: string,
  item: string,
  type: string,
  number: string,
  year: number,
  title: string,
  stageRaw: string,
  stageNorm: string | null,
  appear: readonly E2eRole[],
  restricted = false,
  bench = false,
  day: 0 | 1 = 0,
): Row {
  return {
    n,
    forum,
    hall,
    item,
    day,
    type,
    number,
    year,
    title,
    stageRaw,
    stageNorm,
    appear,
    ...(restricted ? { restricted: true as const } : {}),
    ...(bench ? { bench: true } : {}),
  };
}

export interface CourtDayOptions {
  /** Store two lists for Forum A, the later one changing items 10, 12 and 14. Default true. */
  diff?: boolean;
  /** Record a degraded parse run for Forum B that left Hall 12 unreadable. Default true. */
  failure?: boolean;
  /** Seed the listings at all. Default true; false leaves the day empty. */
  listings?: boolean;
}

/** Seed the chamber day into the worker database. Returns the two dates. */
export async function seedCourtDay(
  db: WorkerDb,
  { diff = true, failure = true, listings = true }: CourtDayOptions = {},
): Promise<{ today: string; tomorrow: string }> {
  const today = istDate(0);
  const tomorrow = istDate(1);
  if (!listings) return { today, tomorrow };
  const ws = COURTS_WORKSPACE_ID;
  const sql = postgres(databaseUrl(db.name, 'owner'), { max: 1, onnotice: () => undefined });
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${ws}, true)`;
      const forums = new Map<string, string>();
      for (const [key, code] of [
        ['A', HALLS_FORUM],
        ['B', DEGRADED_FORUM],
      ] as const) {
        const [found] = await tx<{ id: string }[]>`
          select id from forum where workspace_id is null and code = ${code}`;
        if (found === undefined) throw new Error(`e2e: catalogue forum ${code} is missing`);
        forums.set(key, found.id);
      }
      const members = new Map<E2eRole, string>();
      const users = new Map<E2eRole, string>();
      for (const role of ['owner', 'clerk', 'viewer'] as const) {
        const user = e2eUser(role);
        const [found] = await tx<{ id: string }[]>`
          select id from member where workspace_id = ${ws} and user_id = ${user.id}`;
        if (found === undefined) throw new Error(`e2e: no ${role} member in the courts workspace`);
        members.set(role, found.id);
        users.set(role, user.id);
      }
      const halls = new Map<string, string>();
      for (const r of ROWS) {
        const forum = forums.get(r.forum) as string;
        const key = `${r.forum}-${r.hall}`;
        if (!halls.has(key)) {
          const hallId = id(100 + halls.size);
          await tx`
            insert into court_hall (id, forum_id, hall_no)
            values (${hallId}, ${forum}, ${r.hall})`;
          halls.set(key, hallId);
        }
      }
      // The hall the moved item came from: a hall of its own, so "Moved from Hall 4" is a real hall.
      await tx`
        insert into court_hall (id, forum_id, hall_no)
        values (${id(190)}, ${forums.get('A') as string}, '4')`;
      const benchId = id(150);
      await tx`
        insert into bench (id, forum_id, judges, bench_kind)
        values (${benchId}, ${forums.get('A') as string}, ${[COURT_DAY.judge]}::text[], 'single')`;

      for (const r of ROWS) {
        const date = r.day === 0 ? today : tomorrow;
        const matterId = id(1000 + r.n);
        const proceedingId = id(2000 + r.n);
        const listingId = id(3000 + r.n);
        await tx`
          insert into matter (id, workspace_id, title, sensitive)
          values (${matterId}, ${ws}, ${r.title}, false)`;
        await tx`
          insert into proceeding (id, workspace_id, matter_id, forum_id, kind, case_type_code, number,
            year, state, source_type, confirmation_state)
          values (${proceedingId}, ${ws}, ${matterId}, ${forums.get(r.forum) as string}, 'main',
                  ${r.type}, ${r.number}, ${r.year}, 'numbered', 'manual', 'confirmed')`;
        await tx`
          insert into listing (id, workspace_id, proceeding_id, list_date, list_type, item_no,
            stage_raw, stage_norm, hall_id, bench_id, source_type, confirmation_state)
          values (${listingId}, ${ws}, ${proceedingId}, ${date}, 'daily', ${r.item}, ${r.stageRaw},
                  ${r.stageNorm}, ${halls.get(`${r.forum}-${r.hall}`) as string},
                  ${r.bench === true ? benchId : null}, 'manual', 'confirmed')`;
        if (r.restricted === true) {
          await tx`
            insert into matter_restriction (workspace_id, matter_id, allowed_user_ids)
            values (${ws}, ${matterId}, ${[users.get('owner') as string]}::uuid[])`;
        }
        if (r.n === 3) {
          // Awaiting the member's confirmation: it shows under "Needs you".
          await tx`update listing set confirmation_state = 'proposed' where id = ${listingId}`;
        }
        if (r.n === 2) {
          // The same proceeding was listed yesterday: it shows in the carry list.
          await tx`
            insert into listing (id, workspace_id, proceeding_id, list_date, list_type, stage_raw,
              source_type, confirmation_state)
            values (${id(3500)}, ${ws}, ${proceedingId}, ${istDate(-1)}, 'daily', 'FOR HEARING',
                    'manual', 'confirmed')`;
        }
        for (const [i, role] of r.appear.entries()) {
          const hearingId = id(4000 + r.n);
          if (i === 0) {
            await tx`
              insert into hearing (id, workspace_id, listing_id, held_on, source_type, confirmation_state)
              values (${hearingId}, ${ws}, ${listingId}, ${date}, 'manual', 'confirmed')`;
          }
          await tx`
            insert into appearance (workspace_id, hearing_id, member_id, capacity)
            values (${ws}, ${hearingId}, ${members.get(role) as string}, 'arguing')`;
        }
      }

      if (diff) {
        const forumA = forums.get('A') as string;
        const snap = (
          at: string,
          kind: 'daily' | 'supplementary',
          rows: readonly (readonly [string, string, string])[],
        ) => ({
          at,
          kind,
          rows: rows.map(([proceedingKey, hallNo, itemNo]) => ({
            proceedingKey,
            hallNo,
            itemNo,
            stage: null,
          })),
        });
        const lists = [
          snap('1 hour', 'daily', [
            [COURT_DAY.first, '3', '1'],
            [COURT_DAY.moved, '4', '14'],
            [COURT_DAY.clashB, '7', '22'],
            [COURT_DAY.removed, '3', '12'],
          ]),
          snap('0 seconds', 'supplementary', [
            [COURT_DAY.first, '3', '1'],
            [COURT_DAY.moved, '3', '14'],
            [COURT_DAY.clashB, '7', '22'],
            [COURT_DAY.added, '3', '10'],
          ]),
        ];
        for (const [i, list] of lists.entries()) {
          await tx`
            insert into list_snapshot (id, workspace_id, forum_id, list_date, list_type, content_hash,
              rows, created_at)
            values (${id(5000 + i)}, ${ws}, ${forumA}, ${today}, ${list.kind},
                    ${(i + 1).toString(16).padStart(64, 'a')}, ${tx.json(list.rows)},
                    now() - ${list.at}::interval)`;
        }
      }

      if (failure) {
        const documentId = id(6000);
        await tx`
          insert into document (id, workspace_id, kind, storage_key, sha256)
          values (${documentId}, ${ws}, 'cause_list', ${`ws/${ws}/document/${documentId}`},
                  ${'b'.repeat(64)})`;
        await tx`
          insert into adapter_parse_run (workspace_id, document_id, adapter_id, adapter_version,
            forum_code, rows_parsed, rows_anchored, unmapped_headings, unknown_case_types,
            halls_seen, halls_unreadable, status)
          values (${ws}, ${documentId}, 'in.tn.madras-hc.principal', '1.0.0', ${DEGRADED_FORUM},
                  18, 17, 0, 0, ${['1']}::text[], ${['12']}::text[], 'degraded')`;
      }
    });
  } finally {
    await sql.end();
  }
  return { today, tomorrow };
}
