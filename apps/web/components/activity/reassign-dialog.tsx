'use client';
// "Moved to wrong matter? Reassign" (#49): pick the right matter and the engine (`reassignCapture`)
// moves everything created from that capture there. The result is announced in the feed's live
// region; the engine checks `matter.read` and `matter.write` on the target.
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { MatterSearchHit } from '../../app/(app)/w/[slug]/matters/actions.ts';
import type { Result } from '../../lib/safe-action.ts';

import { MatterPicker } from './matter-picker.tsx';

export interface ReassignDialogProps {
  workspaceId: string;
  captureId: string;
  actions: {
    reassign: (input: {
      workspaceId: string;
      captureId: string;
      matterId: string;
    }) => Promise<Result<unknown>>;
    searchMatters: (input: {
      workspaceId: string;
      q: string;
    }) => Promise<Result<MatterSearchHit[]>>;
  };
  onReassigned: () => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function ReassignDialog({
  workspaceId,
  captureId,
  actions,
  onReassigned,
  onClose,
  onCloseAutoFocus,
}: ReassignDialogProps) {
  const t = useTranslations('activity.reassign');
  const [picked, setPicked] = useState<MatterSearchHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    if (picked === null) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await actions.reassign({ workspaceId, captureId, matterId: picked.id });
      if (result.ok) {
        onReassigned();
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-slot="reassign-dialog" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <MatterPicker
          workspaceId={workspaceId}
          search={actions.searchMatters}
          selectedId={picked?.id}
          onSelect={setPicked}
        />
        {failed ? (
          <p role="alert" className="text-danger text-sm">
            {t('error')}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={picked === null || busy}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? t('working') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
