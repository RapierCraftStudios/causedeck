// Matter-graph domain events (#362, part 1 of #33). The services never import audit, notification
// or job code: they emit these through an injected `GraphEvents` port, and audit, notifications and
// AI work attach to that port elsewhere. Every event names its matter and carries the matter's
// `sensitive` flag, so a subscriber can refuse AI work for a sensitive matter (CA-10) without a
// lookup. Later #33 parts (#363-#366) append members to the union.
import type { ProceedingLinkKind } from '@causedeck/db/schema';

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

export type GraphEventType = GraphEvent['type'];

/** The port the services emit through; injected by the caller. */
export interface GraphEvents {
  emit(event: GraphEvent): void;
}
