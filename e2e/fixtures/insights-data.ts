// Practice insights e2e data (#966, follow-up of #85). The dashboard is behind the `insights.enabled`
// flag (off by default), so a spec turns it on and seeds past hearings on the matters workspace
// (`chennai-solo`): the owner argued all six, the junior assisted on two. Dates are relative to now
// (the server uses its real clock), so the 4 and 12 week ranges always hold what they should. The
// owner reads workspace totals, which count every appearance row, the junior's too:
//
//   offset (days)   -2   -9   -16   -40   -47   -54
//   brief confirmed yes  yes  yes   NO    yes   yes
//
// The junior appeared on the -9 (kept) and -40 (not kept) days: 1 of 2 (50%). Five of the six get
// a preparedness rating, so the preparedness tile shows (it needs 5). INSIGHTS_EXPECTED derives
// every figure from this table.
// Rows go straight into the worker database as the superuser, as the other product helpers do. No
// Playwright imports.
import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import { databaseUrl } from '../support/db-reset.ts';

import { COURTS_WORKSPACE_ID } from './courts-data.ts';
import { istDate } from './court-day-data.ts';
import { MATTERS } from './matters-data.ts';
import { e2eUser, type E2eRole } from './workspace.ts';

const proceeding = MATTERS.appeal.proceedings[0];

export interface InsightsHearing {
  /** Days from now (negative: in the past). */
  offset: number;
  /** A current brief was confirmed before the hearing. */
  briefed: boolean;
  /** The preparedness rating the owner tapped, if any. */
  rating: number | null;
  /** The junior assisted at this hearing. */
  junior: boolean;
}

export const INSIGHTS_HEARINGS: readonly InsightsHearing[] = [
  { offset: -2, briefed: true, rating: 4, junior: false },
  { offset: -9, briefed: true, rating: 4, junior: true },
  { offset: -16, briefed: true, rating: 5, junior: false },
  { offset: -40, briefed: false, rating: 3, junior: true },
  { offset: -47, briefed: true, rating: 4, junior: false },
  { offset: -54, briefed: true, rating: null, junior: false },
];

/** One range of the picker, as day offsets from today (inclusive; the server's window ends today). */
interface Span {
  from: number;
  to: number;
}

/** 4 weeks is 28 days ending today; 12 weeks is 84; the previous period is the span just before. */
const SPAN_4W: Span = { from: -27, to: 0 };
const SPAN_12W: Span = { from: -83, to: 0 };
const SPAN_PREVIOUS_4W: Span = { from: -55, to: -28 };

/**
 * The workspace totals of a span, by the core rule: every appearance row counts (the owner's and
 * the junior's, so a hearing the junior assisted at is two appearances), and one is kept when a
 * current brief was confirmed before the hearing (no obligations are seeded).
 */
function reading(span: Span, own: 'owner' | 'junior' | 'workspace') {
  let appearances = 0;
  let kept = 0;
  for (const h of INSIGHTS_HEARINGS) {
    if (h.offset < span.from || h.offset > span.to) continue;
    const here =
      own === 'workspace' ? 1 + Number(h.junior) : own === 'junior' ? Number(h.junior) : 1;
    appearances += here;
    if (h.briefed) kept += here;
  }
  const percent = appearances === 0 ? 0 : Math.round((kept / appearances) * 100);
  return { appearances, kept, percent, text: `${String(percent)}%` };
}

const workspace12w = reading(SPAN_12W, 'workspace');
const workspace4w = reading(SPAN_4W, 'workspace');
const workspacePrevious = reading(SPAN_PREVIOUS_4W, 'workspace');
const junior12w = reading(SPAN_12W, 'junior');
const ratings = INSIGHTS_HEARINGS.flatMap((h) => (h.rating === null ? [] : [h.rating]));

/**
 * What the seeded data reads as, per viewer and range (the specs assert these figures). With the
 * table above: workspace 12 weeks 6 of 8 (75%); 4 weeks 4 of 4 (100%) against 2 of 4 (50%) before;
 * the junior 1 of 2 (50%). The owner sees workspace totals, so the junior's appearances count.
 */
export const INSIGHTS_EXPECTED = {
  owner12w: {
    percent: workspace12w.text,
    percentNumber: workspace12w.percent,
    appearances: workspace12w.appearances,
    kept: workspace12w.kept,
  },
  owner4w: {
    percent: workspace4w.text,
    percentNumber: workspace4w.percent,
    appearances: workspace4w.appearances,
    previousPercentNumber: workspacePrevious.percent,
  },
  junior12w: {
    percent: junior12w.text,
    percentNumber: junior12w.percent,
    appearances: junior12w.appearances,
  },
  /** The ratings 4, 4, 5, 3, 4: all five, since the rating is the owner's own. */
  preparednessAverage: (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1),
  preparednessRatings: ratings.length,
} as const;

async function withSql<T>(database: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/**
 * Turn `insights.enabled` on. `workspace` limits it to the matters workspace; without it a global
 * row turns it on everywhere (the flag is not legal-gated). Either insert fires `flag_changed`,
 * which empties the server's flag cache.
 */
export function enableInsights(database: string, scope: 'workspace' | 'global' = 'workspace') {
  return withSql(database, async (sql) => {
    const owner = e2eUser('owner').id;
    if (scope === 'global') {
      await sql`
        insert into feature_flag (key, enabled, updated_by)
        values ('insights.enabled', true, ${owner})
        on conflict (key) do update set enabled = true`;
      return;
    }
    await sql`
      insert into workspace_feature_flag (workspace_id, key, enabled, updated_by)
      values (${COURTS_WORKSPACE_ID}, 'insights.enabled', true, ${owner})
      on conflict do nothing`;
  });
}

/** Past hearings with appearances, briefs and ratings; see the table at the top of the file. */
export function seedInsights(database: string): Promise<void> {
  const ws = COURTS_WORKSPACE_ID;
  return withSql(database, async (sql) => {
    const memberOf = async (role: E2eRole): Promise<string> => {
      const [found] = await sql<{ id: string }[]>`
        select id from member where workspace_id = ${ws} and user_id = ${e2eUser(role).id}`;
      if (found === undefined) throw new Error(`e2e: no ${role} member in the workspace`);
      return found.id;
    };
    const owner = await memberOf('owner');
    const junior = await memberOf('junior');
    for (const h of INSIGHTS_HEARINGS) {
      const day = istDate(h.offset);
      const listingId = randomUUID();
      const hearingId = randomUUID();
      const ownerAppearanceId = randomUUID();
      await sql`
        insert into listing (id, workspace_id, proceeding_id, list_date, list_type, stage_raw,
          canonical, source_type, confirmation_state)
        values (${listingId}, ${ws}, ${proceeding.id}, ${day}, 'daily', 'For hearing', false,
                'manual', 'confirmed')`;
      await sql`
        insert into hearing (id, workspace_id, listing_id, held_on, source_type)
        values (${hearingId}, ${ws}, ${listingId}, ${day}, 'manual')`;
      await sql`
        insert into appearance (id, workspace_id, hearing_id, member_id, capacity)
        values (${ownerAppearanceId}, ${ws}, ${hearingId}, ${owner}, 'arguing')`;
      if (h.junior) {
        await sql`
          insert into appearance (workspace_id, hearing_id, member_id, capacity)
          values (${ws}, ${hearingId}, ${junior}, 'assisting')`;
      }
      if (h.briefed) {
        // Confirmed at noon IST the day before: before courts sit (10:00 IST).
        const before = `${istDate(h.offset - 1)}T12:00:00+05:30`;
        await sql`
          insert into brief_state (workspace_id, listing_id, prepared_by, prepared_at)
          values (${ws}, ${listingId}, ${e2eUser('owner').id}, ${before})`;
      }
      if (h.rating !== null) {
        const tapped = `${day}T14:00:00+05:30`;
        await sql`
          insert into preparedness_rating (workspace_id, appearance_id, member_id, rating,
            created_at, updated_at)
          values (${ws}, ${ownerAppearanceId}, ${owner}, ${h.rating}, ${tapped}, ${tapped})`;
      }
    }
  });
}
