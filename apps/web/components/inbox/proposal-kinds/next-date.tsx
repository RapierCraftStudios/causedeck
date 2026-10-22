// `next_date`: the proposed date, large and in tabular numerals (the one thing to decide).
import { formatDate } from '@causedeck/i18n';

import { str, type KindDescriptor } from './types.ts';

export const nextDate: KindDescriptor = {
  fields: [{ key: 'date', label: 'date', type: 'date' }],
  text: (payload, { locale }) => {
    const date = str(payload, 'date');
    return date === null ? '' : formatDate(date, { locale });
  },
  render(payload, ctx) {
    return (
      <span className="font-serif text-2xl leading-tight tabular-nums">
        {nextDate.text(payload, ctx)}
      </span>
    );
  },
};
