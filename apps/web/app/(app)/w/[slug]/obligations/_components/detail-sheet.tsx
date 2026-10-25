'use client';
// The detail sheet (#68, `o`): matter, owner, due date, the source and its quoted line, a reassign
// menu and the drafted next step.
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { useTranslations } from 'next-intl';

import type { NextStep, QueueItem } from '../../../../../../lib/obligations/queue-state.ts';

import { NextStepCard } from './next-step-card.tsx';

export interface DetailSheetProps {
  item: QueueItem | null;
  members: { id: string; name: string }[];
  canAct: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onReassign: (ownerMemberId: string) => void;
  onUseStep: (item: QueueItem, step: NextStep) => void;
}

export function DetailSheet({
  item,
  members,
  canAct,
  pending,
  onOpenChange,
  onReassign,
  onUseStep,
}: DetailSheetProps) {
  const t = useTranslations('obligations');
  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      <SheetContent data-slot="obligation-detail">
        {item === null ? null : (
          <>
            <SheetHeader>
              <SheetTitle>{t('detail.title')}</SheetTitle>
              <SheetDescription>{item.description}</SheetDescription>
            </SheetHeader>
            <dl className="flex flex-col gap-2 px-4 text-sm">
              <dt className="text-ink-muted">{t('detail.matter')}</dt>
              <dd>
                {item.matterTitle}
                {item.caseNumber === null ? '' : ` · ${item.caseNumber}`}
              </dd>
              <dt className="text-ink-muted">{t('detail.owner')}</dt>
              <dd>{item.ownerName ?? t('row.unowned')}</dd>
              <dt className="text-ink-muted">{t('detail.due')}</dt>
              <dd className="tabular-nums">{item.dueDate ?? t('row.undated')}</dd>
              <dt className="text-ink-muted">{t('detail.source')}</dt>
              <dd>{t(`sourceType.${item.sourceType as 'manual'}`)}</dd>
              <dt className="text-ink-muted">{t('detail.quote')}</dt>
              <dd>{item.sourceQuote ?? t('detail.noQuote')}</dd>
            </dl>
            {canAct ? (
              <label className="flex flex-col gap-1 px-4 text-sm">
                {t('detail.reassign')}
                <select
                  className="border-line bg-surface min-h-11 rounded-md border px-2"
                  value={item.ownerMemberId ?? ''}
                  disabled={pending}
                  onChange={(event) => {
                    if (event.target.value !== '') onReassign(event.target.value);
                  }}
                >
                  <option value="" disabled>
                    {t('row.unowned')}
                  </option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="px-4 pb-4">
              <NextStepCard
                item={item}
                disabled={!canAct || pending}
                onUse={(s) => {
                  onUseStep(item, s);
                }}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
