// The stage line (#60): the listing's printed stage heading, with the listing's own provenance.
import { hasProvenance, type BriefLine } from '@causedeck/validators';

import { provenanceOf, type ListingContext } from '../assemble.ts';

export function stageSection(listing: ListingContext): BriefLine | null {
  const line: BriefLine = {
    text: listing.stageRaw,
    label: null,
    page_no: null,
    quote: null,
    ...provenanceOf(listing.row),
  };
  return hasProvenance(line) ? line : null;
}
