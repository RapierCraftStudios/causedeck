import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

/**
 * Matte paper card: 1 px `--line` border, `--radius-lg`, no shadow (cards do not float). Compact
 * 16 px padding and 12 px gaps keep record cards dense.
 */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'bg-surface-raised text-ink border-line flex flex-col gap-3 rounded-lg border py-4',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min items-start gap-1 px-4',
        'has-data-[slot=card-action]:grid-cols-[1fr_auto]',
        className,
      )}
      {...props}
    />
  );
}

export interface CardTitleProps extends ComponentProps<'div'> {
  /** Render the child (e.g. an `h2`) with title styling, to fit the page's heading outline. */
  asChild?: boolean;
}

/** Serif `lg` title. */
export function CardTitle({ asChild = false, className, ...props }: CardTitleProps) {
  const Comp = asChild ? Slot.Root : 'div';
  return (
    <Comp
      data-slot="card-title"
      className={cn('text-ink font-serif text-lg font-medium', className)}
      {...props}
    />
  );
}

/** Meta line under the title: `xs`, `--ink-subtle`. */
export function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-ink-subtle text-xs', className)}
      {...props}
    />
  );
}

/** Top-right slot in the header (a menu or icon button). */
export function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-4 text-base', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex flex-wrap items-center gap-2 px-4', className)}
      {...props}
    />
  );
}
