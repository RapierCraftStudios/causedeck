// `obligation_from_direction`: a direction in an order with its due date. Never bulk-confirmed.
import { formatDate } from '@causedeck/i18n';

import { str, type KindDescriptor } from './types.ts';

export const obligationFromDirection: KindDescriptor = {
  fields: [
    { key: 'description', label: 'description', type: 'text' },
    { key: 'dueDate', label: 'dueDate', type: 'date' },
  ],
  text(payload, { locale }) {
    const due = str(payload, 'dueDate');
    const text = str(payload, 'description') ?? '';
    return due === null ? text : `${text} · ${formatDate(due, { locale })}`;
  },
  render(payload, ctx) {
    return <span>{obligationFromDirection.text(payload, ctx)}</span>;
  },
};
