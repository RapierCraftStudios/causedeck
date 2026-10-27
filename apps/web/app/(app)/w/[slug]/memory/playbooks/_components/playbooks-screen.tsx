'use client';
// The playbooks screen (#903): the form that proposes a playbook, the pending proposals as a
// Proposal Tray (S saves, E loads it back into the form, X dismisses) and the saved playbooks.
// A playbook is saved only after the lawyer confirms the proposal. Offline everything is read-only.
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
import { PatternEmptyState, ProposalTray, ScopeChip } from '@causedeck/ui/patterns';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  PlaybookEditor,
  type PlaybookDraft,
} from '../../../../../../../components/memory/playbook-editor.tsx';
import { useOnline } from '../../../../../../../components/settings/settings-offline-banner.tsx';
import {
  m5ScreenState,
  type PlaybookCardView,
} from '../../../../../../../lib/memory/m5-state.ts';
import { dismissAction } from '../../actions.ts';
import { useMemoryRun } from '../../_components/memory-cards.tsx';
import {
  confirmPlaybookAction,
  deletePlaybookAction,
  proposePlaybookAction,
} from '../../m5-actions.ts';

export interface PlaybookProposalView {
  id: string;
  playbook: PlaybookDraft;
}

export interface PlaybooksScreenProps {
  workspaceId: string;
  canWrite: boolean;
  forceOffline: boolean;
  cards: PlaybookCardView[];
  proposals: PlaybookProposalView[];
}

export function PlaybooksScreen({
  workspaceId,
  canWrite,
  forceOffline,
  cards,
  proposals,
}: PlaybooksScreenProps) {
  const t = useTranslations('memoryM5');
  const format = useFormatter();
  const online = useOnline() && !forceOffline;
  const { run, busy } = useMemoryRun();
  // The proposal whose wording is being edited: proposing the edit retires the earlier proposal.
  const [editing, setEditing] = useState<PlaybookProposalView | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const readOnly = !canWrite || !online;
  const state = m5ScreenState({ count: cards.length, proposals: proposals.length, offline: !online });

  const propose = (playbook: PlaybookDraft) => {
    void run(async () => {
      const result = await proposePlaybookAction({ workspaceId, playbook });
      if (result.ok && editing !== null) {
        await dismissAction({ workspaceId, proposalId: editing.id });
        setEditing(null);
      }
      return result;
    }, t('editor.proposed'));
  };

  return (
    <div className="flex flex-col gap-4" data-screen-state={state}>
      {online ? null : (
        <p role="status" data-pattern-state="offline" className="text-ink-muted text-sm">
          {t('offline')}
        </p>
      )}
      {canWrite ? null : <p className="text-ink-subtle text-xs">{t('readOnly')}</p>}
      {canWrite ? (
        <PlaybookEditor
          key={editing?.id ?? 'new'}
          initial={editing?.playbook}
          readOnly={!online}
          busy={busy}
          onPropose={propose}
        />
      ) : null}
      <ProposalTray
        proposals={proposals.map((p) => ({
          id: p.id,
          title: p.playbook.name,
          statement: t('proposal.playbook', { name: p.playbook.name }),
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
          void run(() => confirmPlaybookAction({ workspaceId, proposalId: id }), t('proposal.saved'));
        }}
        onEdit={(id) => {
          setEditing(proposals.find((p) => p.id === id) ?? null);
        }}
        onDismiss={(id) => {
          void run(() => dismissAction({ workspaceId, proposalId: id }), t('proposal.dismissed'));
        }}
      />
      {cards.length === 0 && proposals.length === 0 ? (
        <PatternEmptyState data-pattern-state="empty" message={t('playbooks.empty')} />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('playbooks.listLabel')}>
          {cards.map((card) => (
            <li
              key={card.itemId}
              data-slot="playbook-card"
              className="border-line bg-surface-raised flex flex-col gap-2 rounded-xl border p-4"
            >
              <h2 className="font-serif text-lg font-medium">{card.name}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <ScopeChip
                  scope={card.scope === 'chamber' ? 'workspace' : 'user'}
                  labels={{ user: t('card.mine'), workspace: t('card.chamber') }}
                />
                <span className="text-ink-muted text-xs">{card.format}</span>
              </div>
              {card.standardPrayers.length === 0 ? null : (
                <ol className="list-decimal ps-5 font-serif text-sm">
                  {card.standardPrayers.map((prayer) => (
                    <li key={prayer}>{prayer}</li>
                  ))}
                </ol>
              )}
              <p className="text-ink-subtle text-xs">
                {card.lastUsedAt === null
                  ? t('card.neverUsed')
                  : t('card.lastUsed', {
                      date: format.dateTime(new Date(card.lastUsedAt), { dateStyle: 'medium' }),
                    })}
              </p>
              {readOnly ? null : (
                <div>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setDeleting(card.itemId);
                    }}
                  >
                    {t('card.delete')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent data-slot="playbook-delete-dialog">
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
                  () => deletePlaybookAction({ workspaceId, itemId: deleting }),
                  t('card.deleted'),
                );
              }}
            >
              {t('card.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
