// Karnataka HC: memo of appearance scaffold (#76). Case-type labels come from the adapters catalogue.
import { karnatakaCaseTypes, caption, defineTemplate, heading, narrative, section, signOff, text } from '../common';

const CASE_TYPES = karnatakaCaseTypes('WP', 'WA', 'RFA', 'MFA');

export const memoOfAppearanceKarnataka = defineTemplate({
  code: 'karnataka_hc.memo_of_appearance',
  name: 'Memo of appearance',
  kind: 'memo',
  courtPreset: 'karnataka_hc',
  blocks: [
      heading('Memo of appearance'),
      ...caption(CASE_TYPES, 'Case number or FR number'),
      section(
        'Appearance',
        text('The advocate named below appears for the party named in the narrative that follows.'),
        narrative('Name the party for whom the advocate appears and the capacity (petitioner, respondent or other).', 600),
      ),
      ...signOff(),
  ],
});
