/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use client';

import { ConfirmBar as ConfirmBarPattern } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';

import type { Blocker } from './outcome-model.ts';

interface ConfirmBarProps {
  blocked: Blocker | null;
  pending: boolean;
  status: string;
  note?: string | undefined;
  onConfirm: () => void;
}

/** Confirm stays disabled, with the reason read out, until a human has made every decision. */
export function ConfirmBar({ blocked, pending, status, note, onConfirm }: ConfirmBarProps) {
  const t = useTranslations('outcome');
  return (
    <ConfirmBarPattern
      confirmLabel={t('confirm')}
      blockedReason={
        blocked === null ? undefined : t(`blocked.${blocked === 'nextDate' ? 'nextDate' : blocked}`)
      }
      pending={pending}
      shortcut={t('shortcut')}
      status={status}
      note={note === undefined ? null : <p className="text-sm">{note}</p>}
      onConfirm={onConfirm}
    />
  );
}
