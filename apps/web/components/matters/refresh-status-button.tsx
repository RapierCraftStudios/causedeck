'use client';
// "Refresh status" for one watched proceeding (#593, D-048 tier 4): runs `refreshStatus` (device
// first, server fallback) in the background and says how it was served and what changed. No captcha
// and no court page is ever shown: a changed next date arrives as a proposal to confirm.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import {
  refreshStatus,
  type DeviceLookup,
  type RefreshActions,
  type RefreshResult,
} from '../../lib/case-watch/refresh.ts';

export interface RefreshStatusButtonProps {
  workspaceId: string;
  watchId: string;
  actions: RefreshActions;
  /** The on-device lookup, tried first; absent means every refresh is served by the server. */
  device?: DeviceLookup | undefined;
  disabled?: boolean;
  onDone?: (result: RefreshResult) => void;
}

export function RefreshStatusButton({
  workspaceId,
  watchId,
  actions,
  device,
  disabled,
  onDone,
}: RefreshStatusButtonProps) {
  const t = useTranslations('caseWatch.refresh');
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [pending, start] = useTransition();

  const message = (): string | null => {
    if (result === null) return null;
    if (result.via === 'failed') return t('failed');
    const outcome = t(`outcome.${result.outcome}`, { count: result.proposals });
    return result.via === 'device'
      ? `${t('via.device')} ${outcome}`
      : `${t('via.server', {
          tier: result.tierUsed ?? '-',
          cost: result.costDollars.toFixed(2),
        })} ${outcome}`;
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-slot="refresh-status">
      <Button
        type="button"
        variant="ghost"
        disabled={disabled === true || pending}
        onClick={() => {
          start(async () => {
            const next = await refreshStatus({ workspaceId, watchId }, actions, device);
            setResult(next);
            onDone?.(next);
          });
        }}
      >
        {pending ? t('running') : t('label')}
      </Button>
      <span role="status" className="text-ink-muted text-sm">
        {message()}
      </span>
    </span>
  );
}
