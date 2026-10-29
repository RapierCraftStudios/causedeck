// The handler registry (#47): one handler per `ProposalKind`, checked when it is built. A handler
// for a kind outside the closed list, or whose name says it sends, files, pays, advises, accepts an
// engagement or cites, cannot be registered (`scripts/check-no-l5.ts` checks the same statically,
// and that no handler module imports `notifications` or any outward transport).
import { PROPOSAL_KINDS, type ProposalKind } from '@causedeck/validators/proposal-draft';

import type { ProposalHandler } from '../types.ts';

import { documentAttachHandler } from './document-attach.ts';
import { hearingOutcomeHandler, outwardDraftHandler } from './disabled.ts';
import { feeEntryHandler } from './fee-entry.ts';
import { caseStatusChangeHandler } from './case-status-change.ts';
import { duplicateMergeHandler } from './duplicate-merge.ts';
import { listingUpdateHandler } from './listing-update.ts';
import { memoryItemHandler } from './memory-item.ts';
import { newMatterHandler } from './new-matter.ts';
import { newProceedingHandler } from './new-proceeding.ts';
import { nextDateHandler } from './next-date.ts';
import { obligationFromDirectionHandler } from './obligation-from-direction.ts';
import { orderRecordHandler } from './order-record.ts';
import { partyDetailHandler } from './party-detail.ts';
import { taskHandler } from './task.ts';

/** Kind names the engine never has a handler for (no send, file, pay, advise, accept or cite). */
export const FORBIDDEN_KIND_PATTERN =
  /(^|_)(send|file|e_file|pay|advise|accept_engagement|insert_citation|generate_citation|auto_reply)(_|$)/;

export class HandlerRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandlerRegistrationError';
  }
}

/** The registry of `handlers`, each kind once; throws for an unknown or forbidden kind. */
export function buildHandlerRegistry(
  handlers: readonly ProposalHandler<never>[],
): Readonly<Record<ProposalKind, ProposalHandler<never>>> {
  const registry = new Map<string, ProposalHandler<never>>();
  for (const handler of handlers) {
    const kind: string = handler.kind;
    if (FORBIDDEN_KIND_PATTERN.test(kind)) {
      throw new HandlerRegistrationError(`"${kind}" is an action the engine never performs`);
    }
    if (!(PROPOSAL_KINDS as readonly string[]).includes(kind)) {
      throw new HandlerRegistrationError(`"${kind}" is not a known proposal kind`);
    }
    if (registry.has(kind)) throw new HandlerRegistrationError(`"${kind}" is registered twice`);
    registry.set(kind, handler);
  }
  const missing = PROPOSAL_KINDS.filter((kind) => !registry.has(kind));
  if (missing.length > 0) {
    throw new HandlerRegistrationError(`no handler for: ${missing.join(', ')}`);
  }
  return Object.fromEntries(registry) as Record<ProposalKind, ProposalHandler<never>>;
}

export const HANDLERS = buildHandlerRegistry([
  nextDateHandler,
  hearingOutcomeHandler,
  newMatterHandler,
  newProceedingHandler,
  listingUpdateHandler,
  taskHandler,
  obligationFromDirectionHandler,
  documentAttachHandler,
  orderRecordHandler,
  partyDetailHandler,
  duplicateMergeHandler,
  memoryItemHandler,
  feeEntryHandler,
  outwardDraftHandler,
  caseStatusChangeHandler,
] as unknown as readonly ProposalHandler<never>[]);

/** The handler of `kind`, typed loosely: the engine passes it the payload its own `validate` parsed. */
export function handlerFor(kind: ProposalKind): ProposalHandler {
  return HANDLERS[kind];
}
