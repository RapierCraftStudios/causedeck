// Court-layer domain events (#389, part 4 of #39; ADR 0017), on the matter-graph `GraphEvents`
// pattern: the court services emit through an injected `CourtEvents` port, and the court-day
// reminders (#64) attach to it elsewhere. Every event names its matter and carries the matter's
// `sensitive` flag, so a subscriber can refuse AI work for a sensitive matter (CA-10) without a
// lookup. Events name benches, never judges (PX-9, ME-6).
import type { BenchChangeReason } from '@causedeck/db/schema';

/**
 * A newly active roster moved a proceeding to another bench: one event per `bench_change_alert`
 * created, emitted once the detection has committed.
 */
export interface BenchChangedEvent {
  type: 'bench.changed';
  workspaceId: string;
  actorUserId: string;
  matterId: string;
  /** The matter's `sensitive` flag at the time of the event. */
  sensitive: boolean;
  proceedingId: string;
  alertId: string;
  rosterId: string;
  forumId: string;
  /** The new roster's first day (ISO date). */
  effectiveFrom: string;
  /** Null when the proceeding had no bench under the previous roster. */
  oldBenchId: string | null;
  newBenchId: string;
  reason: BenchChangeReason;
}

export type CourtEvent = BenchChangedEvent;

export type CourtEventType = CourtEvent['type'];

/** The port the court services emit through; injected by the caller. */
export interface CourtEvents {
  emit(event: CourtEvent): void;
}
