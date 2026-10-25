// Funnel and time-to-value reads over `activation_event` (#509). A user belongs to the weekly
// cohort (ISO week, Monday start, Asia/Kolkata) of their `signed_up` event and to that event's
// channel. Counts are distinct users per step; no user id leaves this module.
import { type Queryable } from '@causedeck/db';
import { sql } from 'drizzle-orm';

import { ACTIVATION_STEPS, type ActivationChannel, type ActivationStep } from './record.ts';

export const COHORT_TIMEZONE = 'Asia/Kolkata';

export interface FunnelOptions {
  /** Only cohorts that signed up at or after this instant. */
  since?: Date;
  /** Only users acquired through this channel. */
  channel?: ActivationChannel;
}

export interface FunnelStep {
  step: ActivationStep;
  users: number;
  /** Share of the cohort that reached the step, 0 to 1. */
  conversion: number;
}

export interface FunnelCohort {
  /** The Monday of the cohort week, `YYYY-MM-DD`. */
  week: string;
  signedUp: number;
  steps: FunnelStep[];
}

export interface TimeToValue {
  week: string;
  /** Users in the cohort who reached the first court-day view. */
  reached: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
}

export interface Funnel {
  cohorts: FunnelCohort[];
  timeToFirstCourtDay: TimeToValue[];
}

function cohortFilter({ since, channel }: FunnelOptions) {
  return sql`s.step = 'signed_up'
    ${since === undefined ? sql`` : sql`and s.occurred_at >= ${since.toISOString()}::timestamptz`}
    ${channel === undefined ? sql`` : sql`and s.channel = ${channel}`}`;
}

const WEEK = sql`to_char(date_trunc('week', s.occurred_at at time zone ${COHORT_TIMEZONE}), 'YYYY-MM-DD')`;

/** Step conversion by weekly sign-up cohort, oldest week first. */
export async function funnelByCohort(
  db: Queryable,
  options: FunnelOptions = {},
): Promise<FunnelCohort[]> {
  const rows = await db.execute<{ week: string; step: ActivationStep; users: string | number }>(sql`
    select ${WEEK} as week, e.step as step, count(distinct e.user_id) as users
    from activation_event s
    join activation_event e on e.user_id = s.user_id
    where ${cohortFilter(options)}
    group by 1, 2
    order by 1`);
  const byWeek = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const steps = byWeek.get(row.week) ?? new Map<string, number>();
    steps.set(row.step, Number(row.users));
    byWeek.set(row.week, steps);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, counts]) => {
      const signedUp = counts.get('signed_up') ?? 0;
      return {
        week,
        signedUp,
        steps: ACTIVATION_STEPS.map((step) => {
          const users = counts.get(step) ?? 0;
          return { step, users, conversion: signedUp === 0 ? 0 : users / signedUp };
        }),
      };
    });
}

/** Seconds from sign-up to the first court-day view, per weekly cohort (median and p90). */
export async function timeToFirstCourtDay(
  db: Queryable,
  options: FunnelOptions = {},
): Promise<TimeToValue[]> {
  const rows = await db.execute<{
    week: string;
    reached: string | number;
    median: string | number | null;
    p90: string | number | null;
  }>(sql`
    select ${WEEK} as week,
      count(*) as reached,
      percentile_cont(0.5) within group (order by extract(epoch from e.occurred_at - s.occurred_at)) as median,
      percentile_cont(0.9) within group (order by extract(epoch from e.occurred_at - s.occurred_at)) as p90
    from activation_event s
    join activation_event e on e.user_id = s.user_id and e.step = 'first_court_day_view'
    where ${cohortFilter(options)}
    group by 1
    order by 1`);
  const num = (v: string | number | null) => (v === null ? null : Math.max(0, Number(v)));
  return rows.map((row) => ({
    week: row.week,
    reached: Number(row.reached),
    medianSeconds: num(row.median),
    p90Seconds: num(row.p90),
  }));
}

/** Both reads, for the admin Growth page. */
export async function activationFunnel(
  db: Queryable,
  options: FunnelOptions = {},
): Promise<Funnel> {
  return {
    cohorts: await funnelByCohort(db, options),
    timeToFirstCourtDay: await timeToFirstCourtDay(db, options),
  };
}
