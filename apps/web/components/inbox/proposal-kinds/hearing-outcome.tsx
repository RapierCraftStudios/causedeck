// `order_record`: the order read from a hearing and the next date it gives. This is the slot the
// hearing-outcome capture (#51) will fill; until then it shows the order's own date and next date.
import { formatDate } from '@causedeck/i18n';

import { str, type KindDescriptor } from './types.ts';

export const hearingOutcome: KindDescriptor = {
  fields: [{ key: 'nextDate', label: 'date', type: 'date' }],
  text(payload, { locale }) {
    const next = str(payload, 'nextDate') ?? str(payload, 'orderDate');
    return next === null ? '' : formatDate(next, { locale });
  },
  render: (payload, ctx) => (
    <span className="tabular-nums">{hearingOutcome.text(payload, ctx)}</span>
  ),
};
