// `task`: a to-do read from the capture, with its due date when it has one.
import { formatDate } from '@causedeck/i18n';

import { str, type KindDescriptor } from './types.ts';

export const task: KindDescriptor = {
  fields: [
    { key: 'title', label: 'title', type: 'text' },
    { key: 'dueDate', label: 'dueDate', type: 'date' },
  ],
  text(payload, { locale }) {
    const due = str(payload, 'dueDate');
    const title = str(payload, 'title') ?? '';
    return due === null ? title : `${title} · ${formatDate(due, { locale })}`;
  },
  render: (payload, ctx) => <span>{task.text(payload, ctx)}</span>,
};
