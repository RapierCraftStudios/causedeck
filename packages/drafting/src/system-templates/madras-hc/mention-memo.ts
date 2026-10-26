// Madras HC: mention or adjournment memo scaffold (#76). Case-type labels come from the adapters catalogue.
import {
  madrasCaseTypes,
  caption,
  defineTemplate,
  heading,
  narrative,
  section,
  signOff,
  text,
} from '../common';

const CASE_TYPES = madrasCaseTypes('WP', 'WA', 'CMA', 'WMP');

export const mentionMemoMadras = defineTemplate({
  code: 'madras_hc.mention_memo',
  name: 'Mention or adjournment memo',
  kind: 'memo',
  courtPreset: 'madras_hc',
  blocks: [
    heading('Memo for mention or adjournment'),
    ...caption(CASE_TYPES, 'Case number or S.R. number'),
    section(
      'Request',
      narrative(
        "State the reason the matter is mentioned or the date sought, in the advocate's own words.",
      ),
    ),
    text('Submitted for the consideration of the Court.'),
    ...signOff(),
  ],
});
