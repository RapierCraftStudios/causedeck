'use client';
// The precedents screen (#903): pending suggestions as a Proposal Tray (S saves, E edits the
// wording first, X dismisses with a reason code) and the saved passages. Nothing is saved until
// the lawyer confirms; a dismissal rests the passage for 30 days. Offline everything is read-only.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@causedeck/ui/alert-dialog';
import { Button } from '@causedeck/ui/button';
import { PatternEmptyState, ProposalTray } from '@causedeck/ui/patterns';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@causedeck/ui/sheet';
import { Textarea } from '@causedeck/ui/textarea';
import { PRECEDENT_DISMISS_REASONS as PRECEDENT_REASONS } from '@causedeck/validators';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PrecedentCard } from '../../../../../../../components/memory/precedent-card.tsx';
import { useOnline } from '../../../../../../../components/settings/settings-offline-banner.tsx';
import type { PrecedentCardView } from '../../../../../../../lib/memory/m5-state.ts';
import { m5ScreenState } from '../../../../../../../lib/memory/m5-state.ts';
import { useMemoryRun } from '../../_components/memory-cards.tsx';
import {
  confirmPrecedentAction,
  deletePrecedentAction,
  dismissPrecedentAction,
  retirePrecedentAction,
} from '../../m5-actions.ts';

export interface PrecedentProposalView {
  id: string;
  text: string;
}

export interface PrecedentsScreenProps {
  workspaceId: string;
  canWrite: boolean;
  forceOffline: boolean;
  cards: PrecedentCardView[];
  proposals: PrecedentProposalView[];
}

export function PrecedentsScreen({
  workspaceId,
  canWrite,
  forceOffline,
  cards,
  proposals,
}: PrecedentsScreenProps) {
  const t = useTranslations('memoryM5');
  const online = useOnline() && !forceOffline;
  const { run, busy } = useMemoryRun();
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState<(typeof PRECEDENT_REASONS)[number]>('not_reusable');
  const [editing, setEditing] = useState<PrecedentProposalView | null>(null);
  const [wording, setWording] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const readOnly = !canWrite || !online;
  const state = m5ScreenState({
    count: cards.length,
    proposals: proposals.length,
    offline: !online,
  });

  return (
    <div className="flex flex-col gap-4" data-screen-state={state}>
      {online ? null : (
        <p role="status" data-pattern-state="offline" className="text-ink-muted text-sm">
          {t('offline')}
        </p>
      )}
      {canWrite ? null : <p className="text-ink-subtle text-xs">{t('readOnly')}</p>}
      <ProposalTray
        proposals={proposals.map((p) => ({
          id: p.id,
          title: t('precedents.title'),
          statement: t('proposal.precedent', { text: p.text }),
          evidence: t('proposal.evidence'),
        }))}
        offline={!online}
        viewOnly={!canWrite}
        disabled={busy}
        labels={{
          heading: (count) => t('proposal.heading', { count }),
          save: t('proposal.save'),
          edit: t('proposal.edit'),
          dismiss: t('proposal.dismiss'),
          shortcuts: t('proposal.shortcuts'),
          offline: t('proposal.offline'),
          viewOnly: t('readOnly'),
        }}
        onSave={(id) => {
          void run(
            () => confirmPrecedentAction({ workspaceId, proposalId: id }),
            t('proposal.saved'),
          );
        }}
        onEdit={(id) => {
          const found = proposals.find((p) => p.id === id) ?? null;
          setEditing(found);
          setWording(found?.text ?? '');
        }}
        onDismiss={(id) => {
          setReason('not_reusable');
          setDismissing(id);
        }}
      />
      {cards.length === 0 && proposals.length === 0 ? (
        <PatternEmptyState data-pattern-state="empty" message={t('precedents.empty')} />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('precedents.listLabel')}>
          {cards.map((card) => (
            <li key={card.itemId}>
              <PrecedentCard
                card={card}
                readOnly={readOnly}
                busy={busy}
                onRetire={(itemId) => {
                  void run(() => retirePrecedentAction({ workspaceId, itemId }), t('card.retired'));
                }}
                onDelete={setDeleting}
              />
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={dismissing !== null}
        onOpenChange={(open) => {
          if (!open) setDismissing(null);
        }}
      >
        <AlertDialogContent data-slot="precedent-dismiss-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dismissDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dismissDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <fieldset className="flex flex-col gap-2">
            {PRECEDENT_REASONS.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reason"
                  checked={reason === code}
                  onChange={() => {
                    setReason(code);
                  }}
                />
                {t(`reasons.${code}`)}
              </label>
            ))}
          </fieldset>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('dismissDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (dismissing === null) return;
                void run(
                  () => dismissPrecedentAction({ workspaceId, proposalId: dismissing, reason }),
                  t('proposal.dismissed'),
                );
              }}
            >
              {t('dismissDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent data-slot="precedent-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('card.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('card.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('card.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (deleting === null) return;
                void run(
                  () => deletePrecedentAction({ workspaceId, itemId: deleting }),
                  t('card.deleted'),
                );
              }}
            >
              {t('card.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <SheetContent data-slot="precedent-edit-sheet">
          <SheetHeader>
            <SheetTitle>{t('editPassage.title')}</SheetTitle>
          </SheetHeader>
          <label className="flex flex-col gap-1 px-4 text-sm">
            {t('editPassage.label')}
            <Textarea
              rows={8}
              value={wording}
              onChange={(e) => {
                setWording(e.target.value);
              }}
            />
          </label>
          <SheetFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(null);
              }}
            >
              {t('editPassage.cancel')}
            </Button>
            <Button
              type="button"
              disabled={busy || wording.trim() === ''}
              onClick={() => {
                if (editing === null) return;
                void run(
                  () =>
                    confirmPrecedentAction({
                      workspaceId,
                      proposalId: editing.id,
                      text: wording.trim(),
                    }),
                  t('proposal.saved'),
                ).then((ok) => {
                  if (ok) setEditing(null);
                });
              }}
            >
              {t('editPassage.save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
