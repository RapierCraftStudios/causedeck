// Status diff (#591): what changed between two parsed case statuses, and the proposal that follows.
// Only a new next hearing date is staged as a `case_status_change` proposal (date-critical, always
// L2, confirmed through the matter-graph next-date services); stage, bench and new orders are
// reported and ride in the payload as context for the card and for the change alerts (#592).
import type { ParsedCaseStatus } from '@causedeck/adapters';

export interface StatusChanges {
  nextHearingDate: { from: string | null; to: string | null } | null;
  stage: { from: string | null; to: string | null } | null;
  bench: { from: string | null; to: string | null } | null;
  /** Orders in `current` that `previous` did not list (by date, number and href). */
  newOrders: ParsedCaseStatus['orders'];
}

const orderKey = (o: ParsedCaseStatus['orders'][number]): string =>
  JSON.stringify([o.date, o.number, o.href]);

function changed<T>(from: T, to: T): { from: T; to: T } | null {
  return from === to ? null : { from, to };
}

/** The differences; a null `previous` (the first snapshot) counts every present value as new. */
export function diffStatus(
  previous: ParsedCaseStatus | null,
  current: ParsedCaseStatus,
): StatusChanges {
  const seen = new Set((previous?.orders ?? []).map(orderKey));
  return {
    nextHearingDate: changed(previous?.nextHearingDate ?? null, current.nextHearingDate),
    stage: changed(previous?.stage?.raw ?? null, current.stage?.raw ?? null),
    bench: changed(previous?.bench ?? null, current.bench),
    newOrders: current.orders.filter((order) => !seen.has(orderKey(order))),
  };
}

export const hasChanges = (changes: StatusChanges): boolean =>
  changes.nextHearingDate !== null ||
  changes.stage !== null ||
  changes.bench !== null ||
  changes.newOrders.length > 0;

export interface StatusDraftInput {
  proceedingId: string;
  matterId: string;
  watchId: string;
  snapshotId: string;
}

/** The `case_status_change` draft for a new next hearing date, or null when there is none to propose. */
export function statusChangeDraft(
  input: StatusDraftInput,
  changes: StatusChanges,
  current: ParsedCaseStatus,
): Record<string, unknown> | null {
  const date = changes.nextHearingDate?.to;
  if (date === null || date === undefined) return null;
  return {
    kind: 'case_status_change',
    source: {
      type: 'deterministic',
      input: 'status',
      ref: `case_status_snapshot:${input.snapshotId}`,
    },
    payload: {
      proceedingId: input.proceedingId,
      watchId: input.watchId,
      snapshotId: input.snapshotId,
      nextHearingDate: date,
      ...(current.stage ? { stageRaw: current.stage.raw } : {}),
      ...(current.bench ? { bench: current.bench } : {}),
    },
    anchors: [],
    matterId: input.matterId,
    proceedingId: input.proceedingId,
    patternKey: 'status:next_date',
  };
}
