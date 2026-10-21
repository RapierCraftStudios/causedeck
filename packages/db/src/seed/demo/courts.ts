// Courts of the demo seed (#182): the demo workspace's own (A0, workspace-scoped) forums for the
// Madras High Court, the Bengaluru City Civil Court and the High Court of Karnataka, with halls and
// benches. Catalogue rows (null workspace_id) belong to the forum catalogue (#34). Judges are
// fictional.
import type { InferInsertModel } from 'drizzle-orm';

import type { bench, courtHall, forum } from '../../schema/court.ts';

import { fictional } from './people.ts';
import { DEMO_WORKSPACE_ID, demoId, ID_KIND } from './shared.ts';

export type DemoForumKey = 'mhc' | 'ccc' | 'khc';

interface ForumSpec {
  n: number;
  code: string;
  court: string;
  establishment: string;
  seat: string;
  jurisdictionKind: 'high_court' | 'district';
  halls: readonly string[];
  benches: readonly { judges: readonly string[]; kind: 'single' | 'division' }[];
}

const FORUMS: Record<DemoForumKey, ForumSpec> = {
  mhc: {
    n: 1,
    code: 'demo.in.tn.madras-hc.principal',
    court: 'High Court of Madras',
    establishment: 'Principal Seat',
    seat: 'Chennai',
    jurisdictionKind: 'high_court',
    halls: ['4', '12A', '21'],
    benches: [
      { judges: ['Hon. Justice A. Venpa'], kind: 'single' },
      { judges: ['Hon. Justice K. Marudham', 'Hon. Justice T. Neithal'], kind: 'division' },
    ],
  },
  ccc: {
    n: 2,
    code: 'demo.in.ka.bengaluru-city-civil',
    court: 'City Civil Court, Bengaluru',
    establishment: 'City Civil and Sessions Court',
    seat: 'Bengaluru',
    jurisdictionKind: 'district',
    halls: ['CCH-10', 'CCH-27'],
    benches: [{ judges: ['Hon. Judge R. Hoysala'], kind: 'single' }],
  },
  khc: {
    n: 3,
    code: 'demo.in.ka.karnataka-hc.principal',
    court: 'High Court of Karnataka',
    establishment: 'Principal Bench',
    seat: 'Bengaluru',
    jurisdictionKind: 'high_court',
    halls: ['2', '9', '15'],
    benches: [
      { judges: ['Hon. Justice S. Tungabhadra'], kind: 'single' },
      { judges: ['Hon. Justice M. Sharavathi', 'Hon. Justice P. Kabini'], kind: 'division' },
    ],
  },
};

export const DEMO_FORUM_KEYS = Object.keys(FORUMS) as DemoForumKey[];

export function forumId(key: DemoForumKey): string {
  return demoId(ID_KIND.forum, FORUMS[key].n);
}

/** The forum's `i`-th hall (cycled). */
export function hallId(key: DemoForumKey, i: number): string {
  const spec = FORUMS[key];
  return demoId(ID_KIND.hall, spec.n * 100 + (i % spec.halls.length) + 1);
}

/** The forum's `i`-th bench (cycled). */
export function benchId(key: DemoForumKey, i: number): string {
  const spec = FORUMS[key];
  return demoId(ID_KIND.bench, spec.n * 100 + (i % spec.benches.length) + 1);
}

export interface DemoCourtRows {
  forums: InferInsertModel<typeof forum>[];
  halls: InferInsertModel<typeof courtHall>[];
  benches: InferInsertModel<typeof bench>[];
}

export function demoCourtRows(at: Date): DemoCourtRows {
  const rows: DemoCourtRows = { forums: [], halls: [], benches: [] };
  for (const key of DEMO_FORUM_KEYS) {
    const spec = FORUMS[key];
    const id = forumId(key);
    const stamp = { workspaceId: DEMO_WORKSPACE_ID, createdAt: at, updatedAt: at };
    rows.forums.push({
      id,
      ...stamp,
      code: spec.code,
      court: spec.court,
      establishment: spec.establishment,
      seat: spec.seat,
      side: 'not_applicable',
      jurisdictionKind: spec.jurisdictionKind,
      languageProfile: { primary: 'en' },
      adapterLevel: 'A0',
    });
    spec.halls.forEach((hallNo, i) => {
      rows.halls.push({
        id: hallId(key, i),
        ...stamp,
        forumId: id,
        hallNo,
        label: `Court Hall ${hallNo}`,
      });
    });
    spec.benches.forEach((b, i) => {
      rows.benches.push({
        id: benchId(key, i),
        ...stamp,
        forumId: id,
        judges: b.judges.map(fictional),
        benchKind: b.kind,
      });
    });
  }
  return rows;
}
