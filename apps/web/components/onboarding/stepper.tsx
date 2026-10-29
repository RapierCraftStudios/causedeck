'use client';
// The wizard stepper (#92): an ordered list with `aria-current="step"` on the current step (a left
// rail from 768 px), and a thin progress bar with "Step n of N" below that. Done and skipped steps
// say so in text, not only by colour.
import { Progress } from '@causedeck/ui/progress';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from './cn.ts';

export type StepState = 'done' | 'skipped' | 'current' | 'upcoming';

export interface StepperItem {
  id: string;
  label: string;
  state: StepState;
}

export interface StepperProps {
  steps: readonly StepperItem[];
  className?: string;
}

export function Stepper({ steps, className }: StepperProps) {
  const t = useTranslations('onboarding.stepper');
  const index = Math.max(
    0,
    steps.findIndex((step) => step.state === 'current'),
  );
  return (
    <nav aria-label={t('label')} className={className}>
      <div className="flex flex-col gap-1.5 md:hidden">
        <Progress value={((index + 1) / steps.length) * 100} aria-label={t('label')} />
        <p className="text-ink-muted text-sm">
          {t('progress', { current: index + 1, total: steps.length })}
        </p>
      </div>
      <ol className="hidden flex-col gap-1 md:flex" data-slot="onboarding-stepper">
        {steps.map((step, position) => (
          <li
            key={step.id}
            data-step={step.id}
            data-state={step.state}
            {...(step.state === 'current' ? { 'aria-current': 'step' as const } : {})}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm',
              step.state === 'current'
                ? 'bg-surface-sunken text-ink font-medium'
                : 'text-ink-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'border-line-strong flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
                step.state === 'done' && 'bg-accent text-accent-ink border-transparent',
                step.state === 'current' && 'border-accent text-ink',
              )}
            >
              {step.state === 'done' ? <Check className="size-3.5" /> : position + 1}
            </span>
            <span className="flex-1">{step.label}</span>
            {step.state === 'done' ? <span className="sr-only">{t('done')}</span> : null}
            {step.state === 'skipped' ? (
              <span className="text-ink-muted text-xs">{t('skipped')}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
