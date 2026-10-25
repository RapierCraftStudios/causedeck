'use client';
// "Used in" (#73): where one memory influenced output (brief, draft, matching), loaded when the
// popover opens from `memory_usage` and linked to the surface that produced it.
import { Popover, PopoverContent, PopoverTrigger } from '@causedeck/ui/popover';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { usageAction, type UsageResult } from '../actions.ts';

const HREF = { brief: 'briefs', draft: 'drafts', matching: 'matters' } as const;

export interface UsedInProps {
  workspaceId: string;
  slug: string;
  itemId: string;
  matterId: string | null;
  title: string;
  /** Usage cannot be loaded offline. */
  offline: boolean;
}

export function UsedIn({ workspaceId, slug, itemId, matterId, title, offline }: UsedInProps) {
  const t = useTranslations('memory.usedIn');
  const [state, setState] = useState<'idle' | 'loading' | 'failed' | UsageResult>('idle');
  const load = async () => {
    setState('loading');
    const result = await usageAction({
      workspaceId,
      itemId,
      ...(matterId === null ? {} : { matterId }),
    });
    setState(result.ok ? result.data : 'failed');
  };
  return (
    <Popover
      onOpenChange={(open) => {
        if (open && !offline) void load();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-ink min-h-6 underline underline-offset-2"
          aria-label={`${t('title')}: ${title}`}
        >
          {t('title')}
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-2 text-sm">
        {state === 'idle' || state === 'loading' ? <p role="status">{t('loading')}</p> : null}
        {state === 'failed' ? <p role="alert">{t('failed')}</p> : null}
        {typeof state === 'object' && state.entries.length === 0 ? <p>{t('none')}</p> : null}
        {typeof state === 'object' && state.entries.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {state.entries.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/w/${slug}/${HREF[entry.usedIn]}`}
                  className="underline underline-offset-2"
                >
                  {t('open', { kind: t(entry.usedIn) })}
                </Link>{' '}
                <time dateTime={entry.usedAt} className="text-ink-muted text-xs">
                  {entry.usedAt.slice(0, 10)}
                </time>
              </li>
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
