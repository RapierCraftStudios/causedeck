// Matter-graph domain events (#362, part 1 of #33). The services never import audit, notification
// or job code: they emit these through an injected `GraphEvents` port, and audit, notifications and
// AI work attach to that port elsewhere. Every event names its matter and carries the matter's
// `sensitive` flag, so a subscriber can refuse AI work for a sensitive matter (CA-10) without a
// lookup. Later #33 parts (#363-#366) append members to the union. A merge or split (#365) names the
// matter rows moved into (`matterId`), so `sensitive` there is the receiving matter's flag: documents
// moved into a sensitive matter arrive with `sensitive: true`.
import type {
  ConfirmationState,
  ProceedingLinkKind,
  ProceedingState,
  SourceType,
} from '@causedeck/db/schema';
import type { IdentifierSource } from '@causedeck/validators/matter-graph-inputs';

/** What every graph event carries. */
export interface GraphEventBase {
  workspaceId: string;
  actorUserId: string;
  matterId: string;
  /** The matter's `sensitive` flag at the time of the event. */
  sensitive: boolean;
}

export type GraphEvent =
  | (GraphEventBase & { type: 'matter.created' })
  | (GraphEventBase & { type: 'matter.updated'; changed: string[] })
  | (GraphEventBase & { type: 'matter.archived' })
  | (GraphEventBase & { type: 'proceeding.created'; proceedingId: string })
  | (GraphEventBase & {
      type: 'proceeding.identifiers_updated';
      proceedingId: string;
      changed: string[];
    })
  | (GraphEventBase & {
      type: 'proceeding.linked';
      linkId: string;
      fromProceedingId: string;
      toProceedingId: string;
      kind: ProceedingLinkKind;
    })
  | (GraphEventBase & { type: 'document.created'; documentId: string })
  | ProceedingStateChangedEvent
  | (GraphEventBase & {
      type: 'matter.merged';
      fromMatterId: string;
      proceedingIds: string[];
      documentIds: string[];
    })
  | (GraphEventBase & { type: 'matter.merge_undone'; fromMatterId: string })
  | (GraphEventBase & {
      type: 'matter.split';
      newMatterId: string;
      proceedingIds: string[];
      crossingLinks: number;
    })
  | (GraphEventBase & { type: 'matter.split_undone'; newMatterId: string })
  | (GraphEventBase & {
      type: 'proceeding.merged';
      proceedingId: string;
      fromProceedingId: string;
      identifierSources: Record<string, IdentifierSource>;
    })
  | (GraphEventBase & {
      type: 'proceeding.merge_undone';
      proceedingId: string;
      fromProceedingId: string;
    })
  // Next date (#364): a proposal, a conflict with the canonical date (never resolved here), and a
  // confirmation by a member (`actorUserId`), which makes the listing canonical.
  | (GraphEventBase & {
      type: 'listing.next_date_proposed';
      proceedingId: string;
      listingId: string;
      date: string;
    })
  | (GraphEventBase & {
      type: 'listing.next_date_conflict';
      proceedingId: string;
      currentListingId: string;
      proposedListingId: string;
      currentDate: string;
      proposedDate: string;
    })
  | (GraphEventBase & {
      type: 'listing.next_date_confirmed';
      proceedingId: string;
      listingId: string;
      previousListingId: string | null;
      date: string;
    });

/** The provenance a state change was recorded with (#363). */
export interface StateChangeProvenance {
  sourceType: SourceType;
  sourceRef: string | null;
  anchorId: string | null;
  confidence: string | null;
  confirmationState: ConfirmationState;
}

/**
 * A proceeding moved state (#363, ADR 0016). `cureDeadline` (an ISO date) is present only when
 * entering `defects` with one, so the obligation service (#67) can create the cure obligation.
 */
export interface ProceedingStateChangedEvent extends GraphEventBase {
  type: 'proceeding.state_changed';
  proceedingId: string;
  stateChangeId: string;
  from: ProceedingState;
  to: ProceedingState;
  reason: string | null;
  actor: { userId: string; memberId: string };
  provenance: StateChangeProvenance;
  cureDeadline?: string;
}

export type GraphEventType = GraphEvent['type'];

/** The port the services emit through; injected by the caller. */
export interface GraphEvents {
  emit(event: GraphEvent): void;
}
