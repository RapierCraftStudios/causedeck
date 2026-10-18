import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Small optional glyph (no illustrations). Decorative. */
  icon?: ReactNode;
  title: ReactNode;
  /** One line: what is empty and what to do about it. */
  description?: ReactNode;
  /** The primary action, e.g. `<Button>Add matter</Button>`. */
  action?: ReactNode;
  secondaryAction?: ReactNode;
}

/** Illustration-free empty state: a title, a one-line explanation and a primary action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  ...props
}: EmptyStateProps) {
  const hasActions = action !== undefined || secondaryAction !== undefined;
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-col items-center gap-4 px-6 py-10 text-center font-sans', className)}
      {...props}
    >
      {icon === undefined ? null : (
        <span
          data-slot="empty-state-icon"
          aria-hidden="true"
          className="bg-surface-sunken text-ink-muted flex size-10 items-center justify-center rounded-full [&_svg]:size-5"
        >
          {icon}
        </span>
      )}
      <div className="grid max-w-prose gap-1">
        <p data-slot="empty-state-title" className="text-ink text-base font-medium">
          {title}
        </p>
        {description === undefined ? null : (
          <p data-slot="empty-state-description" className="text-ink-muted text-sm text-balance">
            {description}
          </p>
        )}
      </div>
      {hasActions ? (
        <div
          data-slot="empty-state-actions"
          className="flex flex-wrap items-center justify-center gap-2"
        >
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
