// Kinds registered but switched off (#47): `memory_item` until the memory engine (#72), `fee_entry`
// until billing (#83) and `outward_draft` until outward drafting (#69), and `hearing_outcome` until the voice worker job (#542). A draft of one of these is
// kept as a "Needs you" card; accepting it, or any attempt to validate or apply it, throws
// `KindNotEnabled`. They hold no code that sends anything: outward preparation (L4) is #69's.
import type { ProposalKind } from '@causedeck/validators/proposal-draft';

import { KindNotEnabled } from '../errors.ts';
import type { ProposalHandler } from '../types.ts';

export function disabledHandler(kind: ProposalKind, until: string): ProposalHandler<never> {
  const off = (): never => {
    throw new KindNotEnabled(kind, until);
  };
  return { kind, enabled: false, validate: off, apply: off, undo: off };
}

export const memoryItemHandler = disabledHandler(
  'memory_item',
  'waiting for the memory engine, #72',
);
export const feeEntryHandler = disabledHandler('fee_entry', 'waiting for billing, #83');
export const outwardDraftHandler = disabledHandler('outward_draft', 'outward drafts are #69');
export const hearingOutcomeHandler = disabledHandler(
  'hearing_outcome',
  'hearing writes land with the voice worker job, #542',
);
