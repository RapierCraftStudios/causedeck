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

// ---- Bench rosters (#437, part 4 of #391) ----
// `chennai-solo`'s rosters for one of its own forums. A workspace forum, not a catalogue one: a
// confirmed roster creates its missing benches as workspace rows, and `bench.forum_id` must share
// its forum's scope (`bench_forum_id_scope_guard`, mode `same`, ADR 0013), so the import journey
// can only confirm on a workspace forum today. Its name has no "Madras" (courts.spec.ts's search
// expects two Madras cards). Every judge, party and portfolio is fictional; dates fall before the
// frozen clock (2026-03-12), so version 2 is in force on the browser's and the server's today.

/** The workspace forum the rosters belong to (A0, Chennai). */
export const ROSTER_FORUM = {
  id: '00000000-0000-4000-8000-0000000f0001',
  code: 'ws.chennai.fictional-sessions-court',
  court: 'Chennai Fictional Sessions Court',
  seat: 'Chennai',
  jurisdictionKind: 'district',
} as const;

export interface RosterBenchFixture {
  id: string;
  kind: 'single' | 'division';
  judges: string[];
}

export const ROSTER_BENCHES = {
  venpa: {
    id: '00000000-0000-4000-8000-0000000b0001',
    kind: 'single',
    judges: ['Justice A. VENPA (fictional)'],
  },
  division: {
    id: '00000000-0000-4000-8000-0000000b0002',
    kind: 'division',
    judges: ['Justice K. MARUDHAM (fictional)', 'Justice T. NEITHAL (fictional)'],
  },
  kurinji: {
    id: '00000000-0000-4000-8000-0000000b0003',
    kind: 'single',
    judges: ['Justice R. KURINJI (fictional)'],
  },
} as const satisfies Record<string, RosterBenchFixture>;

/** How the rosters page labels a bench: its judges, comma-separated. */
export function benchLabel(bench: RosterBenchFixture): string {
  return bench.judges.join(', ');
}

export interface RosterMatterFixture {
  matterId: string;
  title: string;
  proceedingId: string;
  caseTypeCode: string;
  number: string;
  year: number;
}

export const ROSTER_MATTERS = {
  writ: {
    matterId: '00000000-0000-4000-8000-0000000a1001',
    title: 'Ilango v. Fictional Housing Board',
    proceedingId: '00000000-0000-4000-8000-0000000c1001',
    caseTypeCode: 'WP',
    number: '1234',
    year: 2025,
  },
  revision: {
    matterId: '00000000-0000-4000-8000-0000000a1002',
    title: 'Selvi v. Fictional Transport Corporation',
    proceedingId: '00000000-0000-4000-8000-0000000c1002',
    caseTypeCode: 'CRP',
    number: '56',
    year: 2026,
  },
} as const satisfies Record<string, RosterMatterFixture>;

export interface RosterEntryFixture {
  hallNo: string;
  benchId: string;
  portfolioText: string;
}

export interface RosterFixture {
  id: string;
  version: number;
  status: 'active' | 'superseded';
  effectiveFrom: string;
  effectiveTo: string | null;
  entries: RosterEntryFixture[];
}

/** The hall whose bench changed between the two versions. */
export const CHANGED_HALL = '5';

/** Version 1 (superseded) and version 2 (active, open-ended): hall 5 moved to another bench. */
export const ROSTERS: readonly RosterFixture[] = [
  {
    id: '00000000-0000-4000-8000-0000000e0001',
    version: 1,
    status: 'superseded',
    effectiveFrom: '2026-01-05',
    effectiveTo: '2026-03-02',
    entries: [
      { hallNo: '2', benchId: ROSTER_BENCHES.venpa.id, portfolioText: 'Writ Petitions' },
      { hallNo: CHANGED_HALL, benchId: ROSTER_BENCHES.division.id, portfolioText: 'Writ Appeals' },
    ],
  },
  {
    id: '00000000-0000-4000-8000-0000000e0002',
    version: 2,
    status: 'active',
    effectiveFrom: '2026-03-02',
    effectiveTo: null,
    entries: [
      { hallNo: '2', benchId: ROSTER_BENCHES.venpa.id, portfolioText: 'Writ Petitions' },
      { hallNo: CHANGED_HALL, benchId: ROSTER_BENCHES.kurinji.id, portfolioText: 'Writ Appeals' },
      {
        hallNo: '12A',
        benchId: ROSTER_BENCHES.division.id,
        portfolioText: 'Criminal Revisions',
      },
    ],
  },
];

export const ACTIVE_ROSTER = ROSTERS[1] as RosterFixture;

export interface BenchAlertFixture {
  id: string;
  proceedingId: string;
  matterId: string;
  matterTitle: string;
  oldBenchId: string | null;
  newBenchId: string;
  reason: 'hall' | 'portfolio';
  createdAt: string;
}

/** Open alerts citing version 2: the writ's hall moved; the revision had no bench before. */
export const BENCH_ALERTS: readonly BenchAlertFixture[] = [
  {
    id: '00000000-0000-4000-8000-0000000ad001',
    proceedingId: ROSTER_MATTERS.writ.proceedingId,
    matterId: ROSTER_MATTERS.writ.matterId,
    matterTitle: ROSTER_MATTERS.writ.title,
    oldBenchId: ROSTER_BENCHES.division.id,
    newBenchId: ROSTER_BENCHES.kurinji.id,
    reason: 'hall',
    createdAt: '2026-03-02T10:00:00+05:30',
  },
  {
    id: '00000000-0000-4000-8000-0000000ad002',
    proceedingId: ROSTER_MATTERS.revision.proceedingId,
    matterId: ROSTER_MATTERS.revision.matterId,
    matterTitle: ROSTER_MATTERS.revision.title,
    oldBenchId: null,
    newBenchId: ROSTER_BENCHES.division.id,
    reason: 'portfolio',
    createdAt: '2026-03-02T09:00:00+05:30',
  },
];
