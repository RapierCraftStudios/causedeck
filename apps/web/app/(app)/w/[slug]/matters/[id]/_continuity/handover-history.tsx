'use client';
// Earlier saved versions of the handover note, newest first.
import type { HandoverNote } from '@causedeck/validators';
import { useFormatter, useTranslations } from 'next-intl';

export function HandoverHistory({
  notes,
  members,
}: {
  notes: readonly HandoverNote[];
  members: Record<string, string>;
}) {
  const t = useTranslations('continuity.handover');
  const format = useFormatter();
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="handover-history" className="grid gap-1">
      <h3 id="handover-history" className="text-sm font-medium">
        {t('history')}
      </h3>
      <ul className="grid list-none gap-1 p-0 text-sm">
        {notes.map((n) => (
          <li key={n.id}>
            {t('version', {
              version: n.version,
              date: format.dateTime(new Date(n.created_at), { dateStyle: 'medium' }),
            })}
            {n.recipient_id === null ? '' : ` · ${members[n.recipient_id] ?? ''}`}
            {n.acknowledged_at === null ? '' : ` · ${t('acknowledged')}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
