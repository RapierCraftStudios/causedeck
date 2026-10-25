// Seeds for the bootstrap import journeys (#553). The e2e stack has no job worker, so a batch and
// its plan are inserted straight into the worker database, as the worker would leave them, and the
// page resumes them with `?batch=<id>`. Fictional data only.
import postgres from 'postgres';

import { databaseUrl } from '../../support/db-reset.ts';
import { SHELL_WORKSPACE } from '../shell/helpers.ts';

export const IMPORT_PATH = 'import';

type Plan = Record<string, unknown>;
type Proceeding = Record<string, unknown>;

const src = (id: string) => ({ proposalId: id, captureId: null, kind: 'next_date', anchorIds: [] });
const on = (date: string, id: string) => ({ date, sources: [src(id)] });

function proceeding(key: string, over: Proceeding = {}): Proceeding {
  return {
    key,
    label: `W.P. ${key}/2026`,
    caseType: 'WP',
    caseNumber: key,
    caseYear: 2026,
    forumCode: 'in.tn.madras-hc',
    cnr: null,
    parentKey: null,
    parties: null,
    stage: 'Admission',
    nextDate: null,
    nextDateCandidates: [],
    sources: [src(`p-${key}`)],
    ...over,
  };
}

function matter(tempId: string, title: string, proceedings: Proceeding[], over: Plan = {}): Plan {
  const first = proceedings[0] as { nextDate: unknown };
  return {
    tempId,
    title,
    proceedings,
    nextDate: first.nextDate,
    issues: [],
    confidence: 0.9,
    reason: 'single proceeding',
    sources: proceedings.map((p) => src(`p-${String(p['key'])}`)),
    ...over,
  };
}

const planOf = (matters: Plan[]): Plan => ({
  version: 1,
  today: '2026-10-01',
  matters,
  history: [],
  obligations: [],
  counts: { matchedRows: matters.length, unmatchedRowsCount: 0 },
});

/** A writ petition with its miscellaneous petition in one row. */
const WP_WITH_WMP = matter('m_wp', 'Rao v State', [
  proceeding('10', { nextDate: on('2026-11-05', 'd10') }),
  proceeding('11', {
    caseType: 'WMP',
    label: 'W.M.P. 11/2026',
    parentKey: '10',
    nextDate: on('2026-11-05', 'd11'),
  }),
]);

const APPEAL_CHAIN = matter('m_chain', 'Menon v Menon', [
  proceeding('20', {
    caseType: 'OS',
    label: 'O.S. 20/2019',
    forumCode: 'in.tn.chennai.district',
    nextDate: on('2026-12-02', 'd20'),
  }),
  proceeding('21', { caseType: 'AS', label: 'A.S. 21/2023', parentKey: '20' }),
  proceeding('22', { caseType: 'SA', label: 'S.A. 22/2026', parentKey: '21' }),
]);

const CONFLICT = matter(
  'm_conflict',
  'Clash v State',
  [
    proceeding('30', {
      nextDateCandidates: [on('2026-11-03', 'd30'), on('2026-11-17', 'd31')],
    }),
  ],
  {
    nextDate: null,
    issues: [
      {
        code: 'conflicting_dates',
        blocking: true,
        proceedingKey: '30',
        dates: ['2026-11-03', '2026-11-17'],
      },
    ],
  },
);

const SR_STAGE = matter('m_sr', 'Pending v State', [
  proceeding('40', { caseNumber: null, label: null, stage: 'SR' }),
]);

export const PLANS = {
  /** W.P. + W.M.P. group, an appeal chain and a plain matter: confirmable as is. */
  grid: planOf([
    WP_WITH_WMP,
    APPEAL_CHAIN,
    matter('m_plain', 'Late v State', [proceeding('50', { nextDate: on('2026-12-09', 'd50') })]),
  ]),
  appealChain: planOf([APPEAL_CHAIN]),
  conflict: planOf([CONFLICT, WP_WITH_WMP]),
  srStage: planOf([SR_STAGE, WP_WITH_WMP]),
} as const;

export type SeedKind = 'processing' | 'failed' | 'nothing' | keyof typeof PLANS;

/** Insert a batch (and its plan) in the shell workspace; resolves to the batch id. */
export async function seedBatch(database: string, kind: SeedKind): Promise<string> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    const plan = kind in PLANS ? PLANS[kind as keyof typeof PLANS] : null;
    const status = kind === 'processing' ? 'processing' : kind === 'failed' ? 'failed' : 'ready';
    const matched = plan === null ? 0 : (plan['matters'] as unknown[]).length;
    const [batch] = await sql<{ id: string; workspace_id: string }[]>`
      insert into import_batch (workspace_id, created_by, status, matched_rows)
      select o.id, m.user_id, ${status}, ${matched}
        from organization o
        join member m on m.workspace_id = o.id and m.role = 'owner'
       where o.slug = ${SHELL_WORKSPACE}
       limit 1
      returning id, workspace_id`;
    if (batch === undefined) throw new Error('import seed: the shell workspace has no owner');
    if (plan !== null) {
      await sql`
        insert into import_plan (workspace_id, batch_id, plan)
        values (${batch.workspace_id}, ${batch.id}, ${sql.json(plan as never)})`;
    }
    return batch.id;
  } finally {
    await sql.end();
  }
}
