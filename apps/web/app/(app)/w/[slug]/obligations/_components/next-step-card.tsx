'use client';
// A drafted next step as a collapsed card (#68). "Use" creates a task or an internal reminder at
// once and keeps a client letter as a draft task; nothing here sends anything.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { suggestNextStep, type NextStep, type QueueItem } from '../../../../../../lib/obligations/queue-state.ts';

export interface NextStepCardProps {
  item: Pick<QueueItem, 'id' | 'source' | 'description'>;
  disabled?: boolean;
  onUse: (step: NextStep) => void;
}

export function NextStepCard({ item, disabled = false, onUse }: NextStepCardProps) {
  const t = useTranslations('obligations.nextStep');
  const [open, setOpen] = useState(false);
  const step = suggestNextStep(item);
  const panel = `next-step-${item.id}`;
  return (
    <div
      data-slot="obligation-next-step"
      className="border-line bg-surface-raised mt-1 rounded-lg border px-3 py-1.5 text-sm"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((value) => !value)}
        className="text-ink-muted min-h-8 text-xs font-medium"
      >
        {open ? t('hide') : t('show')}
      </button>
      {open ? (
        <div id={panel} className="flex flex-col gap-2 pb-1">
          <p className="text-ink">{t(step.type, { text: step.text })}</p>
          {step.type === 'letter' ? (
            <p className="text-ink-muted text-xs">{t('draftOnly')}</p>
          ) : null}
          <div>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onUse(step)}>
              {t('use')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
