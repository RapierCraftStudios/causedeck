// A seeded obligation dataset for the queue performance test (#67): `count` open obligations on
// one matter, spread over the five queue groups by due date (a fifth undated, the rest from 30
// days overdue to 60 days ahead). Every row is manual and fictional.
import { obligation } from '../schema/docket.ts';
import type { Transaction } from '../client.ts';

export interface ObligationFixtureOptions {
  workspaceId: string;
  matterId: string;
  ownerMemberId: string;
  /** The local day the dataset is spread around, `YYYY-MM-DD`. */
  today: string;
  count: number;
}

const DAY_MS = 86_400_000;

function offsetDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Insert the dataset; returns the number of rows written. */
export async function seedObligationQueue(
  tx: Transaction,
  options: ObligationFixtureOptions,
): Promise<number> {
  const { workspaceId, matterId, ownerMemberId, today, count } = options;
  const rows = Array.from({ length: count }, (_, i) => ({
    workspaceId,
    matterId,
    source: 'internal' as const,
    description: `Seeded obligation ${String(i + 1)}`,
    dueDate: i % 5 === 4 ? null : offsetDay(today, (i % 91) - 30),
    ownerMemberId,
    status: 'open' as const,
    sourceType: 'manual' as const,
  }));
  for (let at = 0; at < rows.length; at += 500) {
    await tx.insert(obligation).values(rows.slice(at, at + 500));
  }
  return rows.length;
}
