// Shared types of the automation engine (#47): the handler contract and the scope a handler runs in.
import type { Actor } from '@causedeck/auth/policy';
import type { Transaction, schema } from '@causedeck/db';
import type { ProposalKind } from '@causedeck/validators/proposal-draft';

import type { GraphActor, MatterGraphDeps } from '../matter-graph/index.ts';

import type { AutomationLevel } from './levels.ts';

export type ProposalRow = typeof schema.proposal.$inferSelect;
export type ActivityRow = typeof schema.activity.$inferSelect;

/** The provenance the engine stamps on every graph row a handler writes. */
export interface HandlerProvenance {
  sourceType: 'manual' | 'document' | 'capture' | 'adapter' | 'ai' | 'import' | 'system';
  sourceRef: string | null;
  anchorId: string | null;
  /** Decimal string within 0..1 (`numeric(4,3)`), or null. */
  confidence: string | null;
  confirmationState: 'proposed' | 'confirmed' | 'auto_applied' | 'corrected';
}

/**
 * What a handler runs in: the engine's transaction (already pinned to the workspace), the acting
 * user and a `MatterGraphDeps` over that same transaction, so a matter-graph service the handler
 * calls joins it. Graph events are buffered and emitted only once the transaction has committed.
 */
export interface HandlerScope {
  tx: Transaction;
  actor: GraphActor;
  /** The actor with the role resolved from the membership (for `can()`). */
  member: Actor;
  deps: MatterGraphDeps;
  now: () => Date;
}

export interface AppliedContext<P> {
  payload: P;
  provenance: HandlerProvenance;
  level: AutomationLevel;
  /** The proposal this applies, with what `stage` recorded at submit time. */
  proposalId: string;
  entityRefs: Record<string, unknown>;
  captureId: string | null;
}

/** What a handler returns from `apply`: how to undo it and what it touched. */
export interface AppliedResult {
  /** Stored as `activity.undo_payload`; handed back to `undo` unchanged. */
  undoPayload: Record<string, unknown>;
  /** Stored as `activity.entity_refs`: the graph records touched, by kind (`{ matterId }`). */
  entityRefs: Record<string, unknown>;
  /** One line for the activity feed; names the kind of change, never quotes content. */
  summary: string;
  /** The matter the change landed on, when it has one (for the proposal card and the digest). */
  matterId?: string | null;
  proceedingId?: string | null;
}

export interface ProposalHandler<P = unknown> {
  readonly kind: ProposalKind;
  /** False for a kind registered but switched off (`KindNotEnabled`). */
  readonly enabled: boolean;
  /** Parse the draft's payload; throws a `WorkspaceError` (VALIDATION) when it is not valid. */
  validate(payload: unknown): P;
  /**
   * Optional, at submit time for an L2 draft: record what must exist before a person can decide
   * (e.g. the proposed next-date listing and its conflict). Returns what to keep in `entity_refs`;
   * `supersede` marks a draft that has become moot.
   */
  stage?(
    scope: HandlerScope,
    payload: P,
    provenance: HandlerProvenance,
  ): Promise<{ entityRefs: Record<string, unknown>; supersede?: string }>;
  apply(scope: HandlerScope, ctx: AppliedContext<P>): Promise<AppliedResult>;
  undo(scope: HandlerScope, activity: ActivityRow): Promise<void>;
}
