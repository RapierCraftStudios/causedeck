// `ProposalKind` -> how its card reads (#48). A kind without an entry (an attachment, a duplicate,
// memory, a fee entry, an outward draft) gets the generic descriptor: its kind label and no inline
// editor, so a card is never blank and never guesses a value.
import { hearingOutcome } from './hearing-outcome.tsx';
import { listingUpdate } from './listing-update.tsx';
import { newMatter } from './new-matter.tsx';
import { newProceeding } from './new-proceeding.tsx';
import { nextDate } from './next-date.tsx';
import { obligationFromDirection } from './obligation-from-direction.tsx';
import { partyDetail } from './party-detail.tsx';
import { task } from './task.tsx';
import type { KindDescriptor } from './types.ts';

export type { FieldSpec, KindContext, KindDescriptor, Payload } from './types.ts';

export const GENERIC_KIND: KindDescriptor = {
  fields: [],
  text: () => '',
  render: () => null,
};

const KINDS: Readonly<Record<string, KindDescriptor>> = {
  next_date: nextDate,
  new_matter: newMatter,
  new_proceeding: newProceeding,
  listing_update: listingUpdate,
  obligation_from_direction: obligationFromDirection,
  task,
  party_detail: partyDetail,
  order_record: hearingOutcome,
};

export const descriptorFor = (kind: string | null): KindDescriptor =>
  (kind === null ? undefined : KINDS[kind]) ?? GENERIC_KIND;

/** Kinds whose decision touches a date or a duty: never confirmed in bulk. */
export const DATE_CRITICAL_KINDS: ReadonlySet<string> = new Set([
  'next_date',
  'new_matter',
  'obligation_from_direction',
]);
