import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface HallHeaderProps extends Omit<ComponentProps<'header'>, 'children' | 'title'> {
  /** The hall heading, e.g. `Hall 4`. */
  title: string;
  /** Secondary line: item count, court-is-at text. */
  detail?: ReactNode;
  /** Actions on the right (the court-is-at control). */
  actions?: ReactNode;
  /** Stays under the day header while the column scrolls. */
  sticky?: boolean;
}

/** A hall column header: heading, detail line and actions. */
export function HallHeader({
  title,
  detail,
  actions,
  sticky = false,
  className,
  ...props
}: HallHeaderProps) {
  return (
    <header
      data-slot="hall-header"
      className={cn(
        'bg-surface border-border flex items-start justify-between gap-3 border-b px-3 py-2',
        sticky && 'sticky top-0 z-10',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="font-serif text-base font-medium">{title}</h3>
        {detail === undefined ? null : <p className="text-ink-muted text-xs">{detail}</p>}
      </div>
      {actions === undefined ? null : <div className="flex shrink-0 gap-1">{actions}</div>}
    </header>
  );
}
