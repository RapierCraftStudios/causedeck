'use client';
// One saved precedent passage (#903): the passage text in the editorial serif is the hero, with
// scope (Mine / Chamber) and provenance as secondary chips, then last use and explicit Retire and
// Delete buttons (no swipe). Read-only (offline or a role without write) shows the text alone.
import { Button } from '@causedeck/ui/button';
import { ProvenanceChip, ScopeChip } from '@causedeck/ui/patterns';
import { useFormatter, useTranslations } from 'next-intl';

import type { PrecedentCardView } from '../../lib/memory/m5-state.ts';

export interface PrecedentCardProps {
  card: PrecedentCardView;
  /** Offline or view-only: the actions are hidden. */
  readOnly?: boolean | undefined;
  busy?: boolean | undefined;
  onRetire?: ((itemId: string) => void) | undefined;
  onDelete?: ((itemId: string) => void) | undefined;
}

export function PrecedentCard({
  card,
  readOnly = false,
  busy = false,
  onRetire,
  onDelete,
}: PrecedentCardProps) {
  const t = useTranslations('memoryM5');
  const format = useFormatter();
  const retired = card.status === 'retired';
  return (
    <article
      data-slot="precedent-card"
      data-status={card.status}
      aria-label={card.kind}
      className="border-line bg-surface-raised motion-safe:animate-fade-in flex flex-col gap-3 rounded-xl border p-4 font-sans"
    >
      <p className="font-serif text-base leading-relaxed whitespace-pre-wrap">{card.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ScopeChip
          scope={card.scope === 'chamber' ? 'workspace' : 'user'}
          labels={{ user: t('card.mine'), workspace: t('card.chamber') }}
        />
        <ProvenanceChip
          source={{
            kind: 'document',
            label: t('card.provenance'),
            anchorId: card.anchorId,
            state: 'confirmed',
          }}
          viewOnly
        />
        <span className="text-ink-muted text-xs">
          {t('card.details', { kind: card.kind, language: card.language })}
        </span>
        {retired ? (
          <span className="text-ink-muted text-xs font-medium">{t('card.retired')}</span>
        ) : null}
      </div>
      <p className="text-ink-subtle text-xs">
        {card.lastUsedAt === null
          ? t('card.neverUsed')
          : t('card.lastUsed', {
              date: format.dateTime(new Date(card.lastUsedAt), { dateStyle: 'medium' }),
            })}
      </p>
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          {retired ? null : (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                onRetire?.(card.itemId);
              }}
            >
              {t('card.retire')}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              onDelete?.(card.itemId);
            }}
          >
            {t('card.delete')}
          </Button>
        </div>
      )}
    </article>
  );
}
