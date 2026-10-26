// Forum-neutral adjournment note for A0 forums (#76).
import { caption, defineTemplate, heading, narrative, section, signOff, text } from '../common';

export const adjournmentNoteA0 = defineTemplate({
  code: 'generic_a0.adjournment_note',
  name: 'Adjournment note',
  kind: 'memo',
  courtPreset: 'generic',
  blocks: [
    heading('Note for adjournment'),
    ...caption('As printed in the cause list', 'Case number'),
    section(
      'Request',
      narrative('State the reason an adjournment is sought and any date proposed.'),
    ),
    text('Submitted for the consideration of the forum.'),
    ...signOff(),
  ],
});
