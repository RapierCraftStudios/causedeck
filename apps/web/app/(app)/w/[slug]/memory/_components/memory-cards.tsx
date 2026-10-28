'use client';
// The memory cards with their actions (#73), shared by the memory screen and the matter's Memory
// tab. Every change goes through a server action and then refreshes the page; offline, the cards
// stay readable and every change is disabled with the screen's explanation.
import { MemoryCard, ScopeChip } from '@causedeck/ui/patterns';
import { toast } from '@causedeck/ui/sonner';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { CardView } from '../../../../../../lib/memory/memory-state.ts';
import type { Result } from '../../../../../../lib/safe-action.ts';
import { deleteAction, editAction, pauseAction } from '../actions.ts';

import { DeleteDialog, EditSheet } from './memory-dialogs.tsx';
import { UsedIn } from './used-in.tsx';

export interface MemoryCardsProps {
  workspaceId: string;
  slug: string;
  cards: CardView[];
  canWrite: boolean;
  isOwner: boolean;
  offline: boolean;
}

/** Run an action, then refresh; a failure is a toast, never a silent no-op. */
export function useMemoryRun() {
  const router = useRouter();
  const t = useTranslations('memory');
  const [busy, setBusy] = useState(false);
  const run = async <O,>(job: () => Promise<Result<O>>, ok: string): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await job();
      if (!result.ok) {
        toast(result.error.code === 'FORBIDDEN' ? t('errors.forbidden') : t('errors.generic'));
        return false;
      }
      toast(ok);
      router.refresh();
      return true;
    } catch {
      toast(t('errors.generic'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

export function MemoryCards({
  workspaceId,
  slug,
  cards,
  canWrite,
  isOwner,
  offline,
}: MemoryCardsProps) {
  const t = useTranslations('memory');
  const format = useFormatter();
  const { run, busy } = useMemoryRun();
  const [editing, setEditing] = useState<CardView | null>(null);
  const [deleting, setDeleting] = useState<CardView | null>(null);
  const target = (card: CardView) => ({
    workspaceId,
    itemId: card.id,
    ...(card.matterId === null ? {} : { matterId: card.matterId }),
  });
  return (
    <>
      <ul className="flex flex-col gap-3" data-slot="memory-cards">
        {cards.map((card) => (
          <li key={card.id}>
            <MemoryCard
              scope={card.layer}
              title={card.title}
              value={card.value}
              scopeLabel={t(`layers.${card.layer}`)}
              scopeChip={
                <ScopeChip
                  scope={card.sharedWithChamber ? 'workspace' : card.scope}
                  labels={{
                    user: t('scope.user'),
                    workspace: t('scope.workspace'),
                    matter: t('scope.matter'),
                  }}
                />
              }
              source={{
                kind:
                  card.sourceType === 'manual'
                    ? 'manual'
                    : card.sourceType === 'ai'
                      ? 'ai'
                      : 'system',
                label: t(`source.${card.sourceType}`),
                state: card.confirmationState === 'corrected' ? 'edited' : 'confirmed',
              }}
              paused={card.paused}
              offline={offline}
              viewOnly={!canWrite}
              lastUsed={
                card.lastUsedAt === null
                  ? t('neverUsed')
                  : t('lastUsed', {
                      date: format.dateTime(new Date(card.lastUsedAt), { dateStyle: 'medium' }),
                    })
              }
              usedIn={
                <UsedIn
                  workspaceId={workspaceId}
                  slug={slug}
                  itemId={card.id}
                  matterId={card.matterId}
                  title={card.title}
                  offline={offline}
                />
              }
              onPause={
                canWrite
                  ? () => {
                      void run(
                        () => pauseAction({ ...target(card), paused: !card.paused }),
                        card.paused ? t('actions.resume') : t('actions.pause'),
                      );
                    }
                  : undefined
              }
              onEdit={
                canWrite
                  ? () => {
                      setEditing(card);
                    }
                  : undefined
              }
              onDelete={
                canWrite
                  ? () => {
                      setDeleting(card);
                    }
                  : undefined
              }
              labels={{
                action: (action, title) => t('actions.cardAction', { action, title }),
                paused: t('actions.paused'),
                pause: t('actions.pause'),
                resume: t('actions.resume'),
                viewOnly: t('readOnly'),
                offline: t('offline'),
                edit: t('actions.edit'),
                delete: t('actions.delete'),
                confirm: t('actions.confirm'),
              }}
            />
          </li>
        ))}
      </ul>
      <EditSheet
        card={editing}
        isOwner={isOwner}
        pending={busy}
        onClose={() => {
          setEditing(null);
        }}
        onSave={(input) => {
          if (editing === null) return;
          void run(() => editAction({ ...target(editing), ...input }), t('edit.saved')).then(
            (ok) => {
              if (ok) setEditing(null);
            },
          );
        }}
      />
      <DeleteDialog
        card={deleting}
        pending={busy}
        onClose={() => {
          setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting === null) return;
          void run(() => deleteAction(target(deleting)), t('delete.done')).then((ok) => {
            if (ok) setDeleting(null);
          });
        }}
      />
    </>
  );
}
