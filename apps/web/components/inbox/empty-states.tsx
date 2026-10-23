'use client';
// The inbox's empty states (#48): Needs you, Ready to send and the first-run screen with the three
// ways to capture and whether each is switched on. (Processing has none: an empty section is not
// drawn.)
import { PatternEmptyState } from '@causedeck/ui/patterns';
import { Check, Mic, Share2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ChannelView } from '../../lib/inbox/view.ts';

export function EmptyNeedsYou() {
  const t = useTranslations('inbox');
  return (
    <PatternEmptyState
      kind="proposals"
      message={`${t('empty.needsYou.title')} ${t('empty.needsYou.body')}`}
    />
  );
}

export function EmptyReady() {
  const t = useTranslations('inbox');
  return <PatternEmptyState message={`${t('empty.ready.title')} ${t('empty.ready.body')}`} />;
}

const CHANNEL_ICONS = { share: Share2, voice: Mic, upload: Upload } as const;

export function FirstRun({ channels }: { channels: ChannelView[] }) {
  const t = useTranslations('inbox');
  return (
    <section
      aria-labelledby="inbox-first-run"
      data-slot="first-run"
      className="bg-surface-raised border-line grid gap-3 rounded-xl border p-6"
    >
      <h2 id="inbox-first-run" className="text-ink font-serif text-xl">
        {t('firstRun.title')}
      </h2>
      <p className="text-ink-muted text-sm">{t('firstRun.body')}</p>
      <ul className="grid gap-2">
        {channels.map((channel) => {
          const Icon = CHANNEL_ICONS[channel.channel];
          return (
            <li key={channel.channel} className="flex items-center gap-3 text-sm">
              <Icon aria-hidden="true" className="text-ink-muted size-4" />
              <span className="text-ink flex-1">{t(`firstRun.${channel.channel}`)}</span>
              <span className="text-ink-muted flex items-center gap-1 text-xs">
                {channel.enabled ? <Check aria-hidden="true" className="size-3" /> : null}
                {channel.enabled ? t('firstRun.on') : t('firstRun.off')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
