'use client';
// The matters-list attention badge (#70): a button with the count of flags the member may see. It
// opens the flag list with the evidence (a popover; `Esc` closes it). With no flags it shows nothing
// to open, so the badge is a count only. All copy comes from the `attention` catalog.
import type { AttentionFlag } from '@causedeck/validators/attention';
import { Button } from '@causedeck/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@causedeck/ui/popover';
import { useTranslations } from 'next-intl';

import { AttentionFlagList } from './attention-list.tsx';

export interface AttentionBadgeProps {
  workspaceId: string;
  flags: readonly AttentionFlag[];
  canWrite: boolean;
}

export function AttentionBadge({ workspaceId, flags, canWrite }: AttentionBadgeProps) {
  const t = useTranslations('attention');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={t('badge', { count: flags.length })}
          data-attention-badge
        >
          {t('badgeLabel', { count: flags.length })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(32rem,90vw)]">
        <AttentionFlagList workspaceId={workspaceId} flags={flags} canWrite={canWrite} />
      </PopoverContent>
    </Popover>
  );
}
