'use client';
// The Needs-you panel (#70): stale-matter flags grouped by rule with counts, in every state
// (default, empty, loading, error, offline, denied). The attention strip (adapter failures and
// list changes) is a separate surface and is not touched here.
import type { AttentionFlag } from '@causedeck/validators/attention';
import type { AttentionState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';

import { AttentionFlagList } from '../matters/_components/attention-list.tsx';

export interface NeedsYouPanelProps {
  workspaceId: string;
  flags: readonly AttentionFlag[];
  state?: AttentionState;
  canWrite: boolean;
  onRetry?: () => void;
}

export function NeedsYouPanel({
  workspaceId,
  flags,
  state = 'default',
  canWrite,
  onRetry,
}: NeedsYouPanelProps) {
  const t = useTranslations('attention');
  return (
    <section aria-labelledby="needs-you-title" className="flex flex-col gap-2">
      <h2 id="needs-you-title" className="font-serif text-lg font-medium">
        {t('title')}
      </h2>
      <AttentionFlagList
        workspaceId={workspaceId}
        flags={flags}
        state={state}
        canWrite={canWrite}
        onRetry={onRetry}
      />
    </section>
  );
}
