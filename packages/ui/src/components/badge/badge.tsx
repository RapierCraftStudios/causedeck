import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export const badgeVariants = cva(
  [
    'inline-flex w-fit max-w-full shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap',
    'rounded-sm border px-2 py-0.5 font-sans text-xs font-medium',
    '[&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0',
    // Links and buttons rendered as badges keep a visible focus ring.
    'outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
    // Forced colours: soft fills disappear, so the border carries the shape.
    'forced-colors:border-current',
  ],
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-sunken text-ink-muted',
        accent: 'border-transparent bg-accent-soft text-accent',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        danger: 'border-transparent bg-danger-soft text-danger',
        info: 'border-transparent bg-info-soft text-info',
        outline: 'border-line-strong bg-transparent text-ink',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
  /** Render the child element (e.g. a link) with badge styling. */
  asChild?: boolean;
}

/** Short status or count label. Always carries text, so colour is never the only signal. */
export function Badge({ tone = 'neutral', asChild = false, className, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span';
  return (
    <Comp
      data-slot="badge"
      data-tone={tone}
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    />
  );
}
