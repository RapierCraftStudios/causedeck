// Matching measures for `tenureMetrics` (#74): how often the lawyer had to correct a match, and how
// often they confirmed what memory proposed, by tenure week. Aggregates only: counts and rates,
// never an alias, a name or a value.
import { sql } from 'drizzle-orm';

import type { Transaction } from '@causedeck/db';

export interface MatchingWeek {
  week: number;
  /** Matches the lawyer corrected (an M7 alias proposal from a correction). */
  corrections: number;
  /** Matches that memory helped (an M7 alias was used in ranking). */
  assisted: number;
  /** corrections / (corrections + assisted); null with no matches that week. */
  correctionRate: number | null;
}

/** corrections / total, to 3 places; null when nothing was matched. */
export function correctionRate(corrections: number, matched: number): number | null {
  const total = corrections + matched;
  return total === 0 ? null : Math.round((corrections / total) * 1000) / 1000;
}

/** Per-week matching counts and correction rate, sorted by week. `week` is a SQL week expression. */
export async function matchingWeeks(
  tx: Transaction,
  workspaceId: string,
  week: (column: string) => ReturnType<typeof sql.raw>,
): Promise<MatchingWeek[]> {
  const corrected = await tx.execute<{ week: number; n: number }>(sql`
    select ${week('proposed_at')} as week, count(*)::int as n
    from memory_proposal
    where workspace_id = ${workspaceId}::uuid and layer = 'M7' and source_type = 'correction'
    group by 1`);
  const assisted = await tx.execute<{ week: number; n: number }>(sql`
    select ${week('used_at')} as week, count(*)::int as n
    from memory_usage
    where workspace_id = ${workspaceId}::uuid and used_in = 'matching'
    group by 1`);
  const byWeek = new Map<number, MatchingWeek>();
  const at = (n: number): MatchingWeek => {
    const key = Math.max(0, n);
    let w = byWeek.get(key);
    if (!w) {
      w = { week: key, corrections: 0, assisted: 0, correctionRate: null };
      byWeek.set(key, w);
    }
    return w;
  };
  for (const r of corrected) at(r.week).corrections += r.n;
  for (const r of assisted) at(r.week).assisted += r.n;
  const weeks = [...byWeek.values()].sort((a, b) => a.week - b.week);
  for (const w of weeks) w.correctionRate = correctionRate(w.corrections, w.assisted);
  return weeks;
}
