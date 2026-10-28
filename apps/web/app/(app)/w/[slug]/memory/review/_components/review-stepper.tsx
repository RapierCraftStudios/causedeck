'use client';
// The monthly review stepper (#73): one candidate at a time with Keep, Edit and Delete; finishing
// records the review date and shows the summary. Edit and Delete reuse the memory screen's dialogs.
import { Button } from '@causedeck/ui/button';
import { MemoryCard } from '@causedeck/ui/patterns';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { CardView } from '../../../../../../../lib/memory/memory-state.ts';
import {
  completeReviewAction,
  deleteAction,
  editAction,
  type ReviewResult,
} from '../../actions.ts';
import { retirePrecedentAction } from '../../m5-actions.ts';
import { useMemoryRun } from '../../_components/memory-cards.tsx';
import { DeleteDialog, EditSheet } from '../../_components/memory-dialogs.tsx';

export interface ReviewStepperProps {
  workspaceId: string;
  slug: string;
  isOwner: boolean;
  /** `m5_playbooks` is on: M5 items can be retired from the review. */
  m5Enabled?: boolean;
  cards: CardView[];
}

export function ReviewStepper({
  workspaceId,
  slug,
  isOwner,
  cards,
  m5Enabled = false,
}: ReviewStepperProps) {
  const t = useTranslations('memory');
  const tm5 = useTranslations('memoryM5');
  const { run, busy } = useMemoryRun();
  const [index, setIndex] = useState(0);
  const [counts, setCounts] = useState({ kept: 0, edited: 0, deleted: 0 });
  const [editing, setEditing] = useState<CardView | null>(null);
  const [deleting, setDeleting] = useState<CardView | null>(null);
  const [summary, setSummary] = useState<ReviewResult | null>(null);
  const [failed, setFailed] = useState(false);
  const card = cards[index];
  const done = card === undefined;
  const target = (c: CardView) => ({
    workspaceId,
    itemId: c.id,
    ...(c.matterId === null ? {} : { matterId: c.matterId }),
  });
  const next = (key: keyof typeof counts) => {
    setCounts((c) => ({ ...c, [key]: c[key] + 1 }));
    setIndex((i) => i + 1);
  };
  const finish = async () => {
    setFailed(false);
    const result = await completeReviewAction({ workspaceId });
    if (result.ok) setSummary(result.data);
    else setFailed(true);
  };

  return (
    <div data-route="memory-review" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('review.title')}</h1>
        <p className="text-ink-muted text-sm">{t('review.hint')}</p>
      </header>
      {summary !== null ? (
        <section aria-labelledby="review-summary" className="flex flex-col gap-2" role="status">
          <h2 id="review-summary" className="text-lg font-semibold">
            {t('review.summaryTitle')}
          </h2>
          <p className="text-sm">
            {t('review.summary', { active: summary.activeItems, paused: summary.pausedItems })}
          </p>
          <p className="text-ink-muted text-sm">
            {t('review.kept', { count: counts.kept })} ·{' '}
            {t('review.edited', { count: counts.edited })} ·{' '}
            {t('review.deleted', { count: counts.deleted })}
          </p>
          <div>
            <Button asChild>
              <Link href={`/w/${slug}/memory`}>{t('review.back')}</Link>
            </Button>
          </div>
        </section>
      ) : done ? (
        <section className="flex flex-col gap-3">
          {cards.length === 0 ? <p className="text-sm">{t('review.nothing')}</p> : null}
          {failed ? (
            <p role="alert" className="text-danger text-sm">
              {t('review.failed')}
            </p>
          ) : null}
          <div>
            <Button
              disabled={busy}
              onClick={() => {
                void finish();
              }}
            >
              {t('review.finish')}
            </Button>
          </div>
        </section>
      ) : (
        <section aria-label={t('review.title')} className="flex flex-col gap-3">
          <p className="text-ink-muted text-sm" aria-live="polite">
            {t('review.step', { current: index + 1, total: cards.length })}
          </p>
          <MemoryCard
            scope={card.layer}
            title={card.title}
            value={card.value}
            scopeLabel={t(`layers.${card.layer}`)}
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
            paused={false}
            lastUsed={
              card.lastUsedAt === null
                ? card.layer === 'M5'
                  ? tm5('review.neverUsed')
                  : t('neverUsed')
                : card.layer === 'M5'
                  ? tm5('review.lastUsed', { date: card.lastUsedAt.slice(0, 10) })
                  : t('lastUsed', { date: card.lastUsedAt.slice(0, 10) })
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
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                next('kept');
              }}
            >
              {t('review.keep')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditing(card);
              }}
            >
              {t('review.edit')}
            </Button>
            {m5Enabled && card.layer === 'M5' ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void run(
                    () => retirePrecedentAction({ workspaceId, itemId: card.id }),
                    tm5('review.retired'),
                  ).then((ok) => {
                    if (ok) next('deleted');
                  });
                }}
              >
                {tm5('review.retire')}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDeleting(card);
              }}
            >
              {t('review.delete')}
            </Button>
          </div>
        </section>
      )}
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
              if (ok) {
                setEditing(null);
                next('edited');
              }
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
            if (ok) {
              setDeleting(null);
              next('deleted');
            }
          });
        }}
      />
    </div>
  );
}
