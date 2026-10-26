// Karnataka HC: early-listing memo scaffold (#76). Case-type labels come from the adapters catalogue.
import {
  karnatakaCaseTypes,
  caption,
  defineTemplate,
  heading,
  narrative,
  section,
  signOff,
  text,
} from '../common';

const CASE_TYPES = karnatakaCaseTypes('WP', 'WA', 'RFA', 'MFA');

export const earlyListingMemoKarnataka = defineTemplate({
  code: 'karnataka_hc.early_listing_memo',
  name: 'Early-listing memo',
  kind: 'memo',
  courtPreset: 'karnataka_hc',
  blocks: [
    heading('Memo for early listing'),
    ...caption(CASE_TYPES, 'Case number or FR number'),
    section(
      'Grounds for early listing',
      narrative('Set out the grounds on which an earlier listing date is requested.'),
    ),
    text('Submitted for the consideration of the Court.'),
    ...signOff(),
  ],
});
