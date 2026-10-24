// The business snapshot reads (#519, D-049): one jsonb document of per-plan aggregates from
// `app_business_snapshot` (migration 0070). The tables behind it are tenant tables under FORCE RLS,
// so staff reach it through `app_staff_business_snapshot`, which refuses anyone but an enabled
// staff member; the daily alert and weekly digest jobs have no staff user and call the unguarded
// variant, as the usage rollup does. Both return numbers and plan ids only, never content.
import { isUuid, withUser, type Queryable, type Transaction } from '@causedeck/db';
import { sql } from 'drizzle-orm';

import { periodStart } from '../usage/index.ts';
import { forbidden } from '../workspaces/index.ts';

/** One plan's aggregates. Fetch costs are fetch_log dollars; every other money value is paise. */
export interface PlanSnapshot {
  planId: string;
  name: string;
  /** Catalogue price, ex-GST; 0 for the free plan. */
  pricePaise: number;
  subscribers: number;
  seats: number;
  /** Monthly recurring revenue: annual plans count one twelfth, per-seat plans their seats. */
  mrrPaise: number;
  new30d: number;
  churned30d: number;
  /** Users with a session touched in the last 1, 7 and 30 days, by the plan of their workspace. */
  dau: number;
  wau: number;
  mau: number;
  /** `ai.spend_paise` of the current IST month. */
  aiSpendPaise: number;
  /** The IST month's fetch_log cost of delegated lookups by this plan's advocates. */
  fetchDollars: number;
  captchaDollars: number;
}

export interface BusinessSnapshot {
  plans: PlanSnapshot[];
  /** fetch_log cost not attributable to a plan: scheduled and shared reads. */
  shared: { fetchDollars: number; captchaDollars: number };
}

const NUMERIC_FIELDS = [
  'pricePaise',
  'subscribers',
  'seats',
  'mrrPaise',
  'new30d',
  'churned30d',
  'dau',
  'wau',
  'mau',
  'aiSpendPaise',
  'fetchDollars',
  'captchaDollars',
] as const;

interface RawSnapshot {
  plans?: Record<string, unknown>[];
  shared?: Record<string, unknown>;
}

const num = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Normalise the jsonb document (the driver may hand it back as text). */
export function parseBusinessSnapshot(raw: unknown): BusinessSnapshot {
  const doc = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as RawSnapshot;
  const plans = (doc.plans ?? []).map((p): PlanSnapshot => {
    const out = { planId: String(p.planId), name: String(p.name) } as PlanSnapshot;
    for (const field of NUMERIC_FIELDS) out[field] = num(p[field]);
    return out;
  });
  return {
    plans,
    shared: {
      fetchDollars: num(doc.shared?.fetchDollars),
      captchaDollars: num(doc.shared?.captchaDollars),
    },
  };
}

interface SnapshotRow extends Record<string, unknown> {
  snapshot: unknown;
}

/** The snapshot for the IST month containing `now`, for jobs (no staff user). Aggregates only. */
export async function readBusinessSnapshot(
  db: Queryable,
  now: Date = new Date(),
): Promise<BusinessSnapshot> {
  const [row] = await db.execute<SnapshotRow>(
    sql`select app_business_snapshot(${periodStart(now).toISOString()}::timestamptz, ${now.toISOString()}::timestamptz) as snapshot`,
  );
  return parseBusinessSnapshot(row?.snapshot);
}

/** The SQLSTATE of a failed query (drizzle wraps the driver error). */
function sqlState(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  return (cause as { code?: string } | null)?.code;
}

/** The snapshot for the staff console; FORBIDDEN unless `staffUserId` is an enabled staff member. */
export async function staffBusinessSnapshot(
  db: Queryable,
  staffUserId: string,
  now: Date = new Date(),
): Promise<BusinessSnapshot> {
  const denied = () => forbidden('Only enabled staff can read the staff console');
  if (!isUuid(staffUserId)) throw denied();
  try {
    return await withUser(db, { userId: staffUserId }, async (tx: Transaction) => {
      const [row] = await tx.execute<SnapshotRow>(
        sql`select app_staff_business_snapshot(${periodStart(now).toISOString()}::timestamptz, ${now.toISOString()}::timestamptz) as snapshot`,
      );
      return parseBusinessSnapshot(row?.snapshot);
    });
  } catch (error) {
    if (sqlState(error) === '42501') throw denied();
    throw error;
  }
}
