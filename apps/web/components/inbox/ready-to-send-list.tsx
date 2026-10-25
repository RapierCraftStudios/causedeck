'use client';
// Ready to send (#48): outward drafts the lawyer sends themselves (L4), from the registered
// providers. Each item offers only the hand-offs its provider defines (copy the text, open it in
// the person's own app) and `Mark as sent by me`, which logs that they sent it. The copy never
// says the system will send anything.
import { Button } from '@causedeck/ui/button';
import { Copy, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ReadyItem } from '../../lib/inbox/ready-providers.ts';

import { EmptyReady } from './empty-states.tsx';

export interface ReadyToSendListProps {
  items: ReadyItem[];
  readOnly: boolean;
  offline: boolean;
  onMarkSent: (item: ReadyItem) => Promise<void>;
}

function ReadyCard({
  item,
  readOnly,
  offline,
  onMarkSent,
}: Omit<ReadyToSendListProps, 'items'> & { item: ReadyItem }) {
  const t = useTranslations('inbox');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <li
      className="bg-surface-raised border-line grid gap-2 rounded-xl border p-4"
      data-slot="ready-card"
    >
      <h3 className="text-ink font-serif text-lg">{item.title}</h3>
      <p className="text-ink-muted text-sm">{item.summary}</p>
      <p className="text-ink-muted text-xs">{t('ready.reminder')}</p>
      <div className="flex flex-wrap gap-2">
        {item.actions.map((action) =>
          action.kind === 'copy' ? (
            <Button
              key={action.id}
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(action.text);
              }}
              className="pointer-coarse:min-h-11"
            >
              <Copy aria-hidden="true" />
              {t('ready.copy')}
            </Button>
          ) : (
            <Button key={action.id} variant="secondary" asChild className="pointer-coarse:min-h-11">
              <a href={action.href} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                {t('ready.openIn', { app: action.app })}
              </a>
            </Button>
          ),
        )}
        {readOnly ? null : (
          <Button
            variant="ghost"
            disabled={busy || done || offline}
            title={offline ? t('offline.decisions') : undefined}
            onClick={() => {
              setBusy(true);
              onMarkSent(item).then(
                () => {
                  setDone(true);
                  setBusy(false);
                },
                () => {
                  setBusy(false);
                },
              );
            }}
            className="pointer-coarse:min-h-11"
          >
            {done ? t('ready.marked') : t('ready.markSent')}
          </Button>
        )}
      </div>
    </li>
  );
}

export function ReadyToSendList(props: ReadyToSendListProps) {
  const t = useTranslations('inbox');
  if (props.items.length === 0) return <EmptyReady />;
  return (
    <section aria-label={t('sections.ready')} data-slot="ready-list">
      <ul className="grid gap-3">
        {props.items.map((item) => (
          <ReadyCard key={`${item.providerId}:${item.id}`} {...props} item={item} />
        ))}
      </ul>
    </section>
  );
}
