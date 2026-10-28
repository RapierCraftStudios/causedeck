'use client';
// One handover note rendered through the ui pattern: version line, the sections, and Acknowledge for
// the recipient. No share, email or export control exists here (#71, R7).
import { HandoverView as HandoverPattern } from '@causedeck/ui/patterns';
import type { HandoverNote } from '@causedeck/validators';
import { useFormatter, useTranslations } from 'next-intl';

import { handoverSections } from './model.ts';

export function HandoverNoteView({
  note,
  canAcknowledge,
  onAcknowledge,
}: {
  note: HandoverNote;
  canAcknowledge: boolean;
  onAcknowledge: () => void;
}) {
  const t = useTranslations('continuity.handover');
  const format = useFormatter();
  const sections = handoverSections(note.body.derived, {
    sections: Object.fromEntries(
      (
        [
          'where_it_stands',
          'last_orders',
          'open_obligations',
          'coming_up',
          'key_documents',
          'open_questions',
        ] as const
      ).map((k) => [k, t(`sections.${k}`)]),
    ),
    noneRecorded: t('noneRecorded'),
    overdue: t('overdue'),
  }).map((s) => {
    const edit = note.body.edits[s.id as keyof typeof note.body.edits];
    return edit === undefined || edit === ''
      ? s
      : { ...s, items: [{ id: `${s.id}-edit`, text: edit }, ...s.items] };
  });
  return (
    <HandoverPattern
      title={t('title')}
      byline={t('version', {
        version: note.version,
        date: format.dateTime(new Date(note.created_at), { dateStyle: 'medium' }),
      })}
      sections={sections}
      {...(canAcknowledge
        ? {
            acknowledge: {
              label: t('acknowledge'),
              doneLabel: t('acknowledged'),
              done: note.acknowledged_at !== null,
              onAcknowledge,
            },
          }
        : {})}
    />
  );
}
