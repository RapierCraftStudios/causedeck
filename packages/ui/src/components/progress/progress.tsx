import { cva, type VariantProps } from 'class-variance-authority';
import { Progress as ProgressPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

const indicatorVariants = cva(
  [
    'h-full transition-[width] duration-(--dur-base) ease-standard',
    // Indeterminate: a full-width soft bar; aria-busy and the missing value carry the state.
    'data-[state=indeterminate]:bg-accent-soft',
    'forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none',
  ],
  {
    variants: {
      tone: { accent: 'bg-accent', success: 'bg-success', danger: 'bg-danger' },
    },
    defaultVariants: { tone: 'accent' },
  },
);

export type ProgressTone = NonNullable<VariantProps<typeof indicatorVariants>['tone']>;

export interface ProgressProps extends ComponentProps<typeof ProgressPrimitive.Root> {
  /** `danger` for a failed upload or job; pair it with visible text. */
  tone?: ProgressTone;
}

/**
 * Determinate or indeterminate (`value={null}`) progress bar. Name it with `aria-label` or
 * `aria-labelledby`. Width changes animate over --dur-base; instant under reduced motion.
 */
export function Progress({
  value,
  max = 100,
  tone = 'accent',
  className,
  ...props
}: ProgressProps) {
  const indeterminate = value === null || value === undefined;
  const percent = indeterminate ? 100 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-tone={tone}
      value={value}
      max={max}
      aria-busy={indeterminate || undefined}
      className={cn(
        'bg-surface-sunken relative h-2 w-full overflow-hidden rounded-full',
        'forced-colors:border forced-colors:border-current',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={indicatorVariants({ tone })}
        style={{ width: `${String(percent)}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
