'use client';
// The sensitive toggle on the matter menu (#390, CA-10). Owners and advocates (`matter.restrict`)
// get a menu item that opens a confirmation; marking explains "AI processing is turned off for this
// matter and it is excluded from bulk imports and shared briefs" before anything changes. Confirm
// calls `setSensitiveAction` (which checks `matter.restrict` again), announces the change and
// refreshes the matter; Cancel or Esc change nothing and focus returns to the menu button. Offline,
// confirming is off with the reason.
import { Alert } from '@causedeck/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@causedeck/ui/alert-dialog';
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';

export type SetSensitiveAction = (input: {
  workspaceId: string;
  matterId: string;
  sensitive: boolean;
}) => Promise<Result<{ id: string; sensitive: boolean }>>;

export interface SensitiveDialogProps {
  workspaceId: string;
  matterId: string;
  /** The flag today; the dialog proposes the other value. */
  sensitive: boolean;
  action: SetSensitiveAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offline?: boolean;
  /** Where focus goes when the dialog closes (the menu button). */
  returnFocus?: (() => HTMLElement | null) | undefined;
}

export function SensitiveDialog({
  workspaceId,
  matterId,
  sensitive,
  action,
  open,
  onOpenChange,
  offline = false,
  returnFocus,
}: SensitiveDialogProps) {
  const t = useTranslations('matters');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const next = !sensitive;

  async function onConfirm() {
    if (pending || offline) return;
    setPending(true);
    setFailed(false);
    let result: Result<{ id: string; sensitive: boolean }>;
    try {
      result = await action({ workspaceId, matterId, sensitive: next });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    onOpenChange(false);
    announce(
      result.data.sensitive ? t('workspace.menu.announceOn') : t('workspace.menu.announceOff'),
    );
    router.refresh();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setFailed(false);
        onOpenChange(value);
      }}
    >
      <AlertDialogContent
        data-slot="sensitive-dialog"
        onCloseAutoFocus={(event) => {
          const target = returnFocus?.() ?? null;
          if (target === null) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {next ? t('workspace.menu.markTitle') : t('workspace.menu.removeTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {next ? t('new.sensitiveHint') : t('workspace.menu.removeHint')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {offline ? (
          <Alert tone="warning" role="status">
            {t('workspace.offlineAction')}
          </Alert>
        ) : null}
        {failed ? (
          <Alert tone="danger" role="alert">
            {t('workspace.menu.failed')}
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('workspace.menu.cancel')}</AlertDialogCancel>
          <Button
            type="button"
            data-sensitive-confirm=""
            loading={pending}
            disabled={pending || offline}
            onClick={() => void onConfirm()}
          >
            {next ? t('workspace.menu.confirmMark') : t('workspace.menu.confirmRemove')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
