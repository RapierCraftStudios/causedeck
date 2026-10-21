// Courts e2e fixture data (#425), shared by support/db-reset.ts (which seeds it into the template
// as the owner role) and the courts specs. No Playwright or workspace-package imports:
// support/server-pool.ts loads db-reset.ts with plain `node --experimental-strip-types`.
//
// The forums are system catalogue rows that `migrate.ts` seeds (packages/db/src/seed/
// forum-catalogue); the seeder checks they still have the level and state named here. What the
// template lacks is this workspace's parse history: `cause_list` documents and their
// `adapter_parse_run` rows (metrics and hall numbers only, never list text).

/** `chennai-solo` (packages/db/src/seed/e2e.ts `E2E_WORKSPACES`); tests/courts asserts they match. */
export const COURTS_WORKSPACE = 'chennai-solo';
export const COURTS_WORKSPACE_ID = '00000000-0000-4000-8000-00000000a001';

/** The Madras HC Principal Seat adapter, active at 1.0.0 since migration 0048. */
export const COURTS_ADAPTER_ID = 'in.tn.madras-hc.principal';
export const COURTS_ADAPTER_VERSION = '1.0.0';

/** A1, Chennai: its newest list was only partly read (Hall 12 unreadable), so it shows the banner. */
export const DEGRADED_FORUM = 'in.tn.madras-hc.principal.original';
/** A1, Chennai: lists read in full, naming halls 2, 5 and 12A. */
export const HALLS_FORUM = 'in.tn.madras-hc.principal.appellate';
/** A0, Chennai: no lists shared, so no halls and no adapter version. */
export const A0_FORUM = 'in.tn.chennai.city-civil-court';
/** Disabled (planned) with a reason, never a link. */
export const PLANNED_FORUM = 'in.tn.madras-hc.madurai';

/** What the seeder expects of each catalogue row; it fails the template build otherwise. */
export const CATALOGUE_EXPECTATIONS = [
  { code: DEGRADED_FORUM, adapterLevel: 'A1', enabled: true },
  { code: HALLS_FORUM, adapterLevel: 'A1', enabled: true },
  { code: A0_FORUM, adapterLevel: 'A0', enabled: true },
  { code: PLANNED_FORUM, adapterLevel: 'A0', enabled: false },
] as const;

/** The hall the degraded run could not read. */
export const UNREADABLE_HALL = '12';

export interface CourtParseRunFixture {
  /** The run's `cause_list` document (one per run). */
  documentId: string;
  forumCode: string;
  rowsParsed: number;
  rowsAnchored: number;
  hallsSeen: string[];
  hallsUnreadable: string[];
  status: 'ok' | 'degraded' | 'failed';
  /** Before the frozen clock (2026-03-12 09:30 IST). The degraded run is the adapter's newest. */
  createdAt: string;
}

export const COURT_PARSE_RUNS: readonly CourtParseRunFixture[] = [
  {
    documentId: '00000000-0000-4000-8000-0000000d0001',
    forumCode: DEGRADED_FORUM,
    rowsParsed: 40,
    rowsAnchored: 38,
    hallsSeen: ['1', UNREADABLE_HALL],
    hallsUnreadable: [],
    status: 'ok',
    createdAt: '2026-03-10T10:00:00+05:30',
  },
  {
    documentId: '00000000-0000-4000-8000-0000000d0002',
    forumCode: HALLS_FORUM,
    rowsParsed: 52,
    rowsAnchored: 50,
    hallsSeen: ['2', '5', '12A'],
    hallsUnreadable: [],
    status: 'ok',
    createdAt: '2026-03-11T10:00:00+05:30',
  },
  {
    documentId: '00000000-0000-4000-8000-0000000d0003',
    forumCode: DEGRADED_FORUM,
    rowsParsed: 18,
    rowsAnchored: 17,
    hallsSeen: ['1'],
    hallsUnreadable: [UNREADABLE_HALL],
    status: 'degraded',
    createdAt: '2026-03-11T18:00:00+05:30',
  },
];
