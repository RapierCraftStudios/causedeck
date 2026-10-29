'use client';

import type { ComputationView, RuleView } from '@causedeck/core/limitation';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { RuleSteps } from './rule-steps.tsx';

export interface ComputationCardProps {
  computation: ComputationView;
  rule?: RuleView | undefined;
  selected: boolean;
  canConfirm: boolean;
  /** Offline: Confirm stays on the card but cannot be pressed. */
  offline?: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onConfirm: (id: string) => void;
}

/** One computation: the last day to file, its status, the working and (for a proposal) Confirm. */
export function ComputationCard({
  computation,
  rule,
  selected,
  canConfirm,
  offline = false,
  busy,
  onSelect,
  onConfirm,
}: ComputationCardProps) {
  const t = useTranslations('limitation');
  const [open, setOpen] = useState(false);
  const proposed = computation.status === 'proposed';
  return (
    <li
      data-slot="limitation-card"
      data-limitation-id={computation.id}
      data-selected={selected ? '' : undefined}
      tabIndex={0}
      onFocus={() => {
        onSelect(computation.id);
      }}
      className="border-line focus-visible:ring-focus data-[selected]:border-accent rounded-md border p-4 transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-ink-muted text-xs">{t('card.expires')}</span>
          <time dateTime={computation.expiresOn} className="font-serif text-xl font-medium">
            {computation.expiresOn}
          </time>
          <span className="text-ink-muted text-xs">
            {t('card.matter', { id: computation.matterId })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge data-status={computation.status}>
            {t(`status.${computation.status as 'proposed' | 'confirmed' | 'superseded'}`)}
          </Badge>
          {proposed && canConfirm && (
            <Button
              size="sm"
              disabled={busy || offline}
              onClick={() => {
                onConfirm(computation.id);
              }}
            >
              {t('card.confirm')}
            </Button>
          )}
        </div>
      </div>
      {computation.ruleCode !== undefined && (
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            {open ? t('card.hideDetails') : t('card.details')}
          </Button>
          {open && <RuleSteps computation={computation} rule={rule} />}
        </div>
      )}
    </li>
  );
}
