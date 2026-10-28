// Madras HC: application for certified copy scaffold (#76). Case-type labels come from the adapters catalogue.
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

export const certifiedCopyApplicationMadras = defineTemplate({
  code: 'madras_hc.certified_copy_application',
  name: 'Application for certified copy',
  kind: 'other',
  courtPreset: 'madras_hc',
  blocks: [
    heading('Application for certified copy'),
    ...caption(CASE_TYPES, 'Case number or S.R. number'),
    section(
      'Copy applied for',
      narrative(
        'Identify the order, judgment or document of which a certified copy is applied for, with its date.',
        800,
      ),
    ),
    text('The applicant requests the certified copy to be issued in the usual course.'),
    ...signOff(),
  ],
});
