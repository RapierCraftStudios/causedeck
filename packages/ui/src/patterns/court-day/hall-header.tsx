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
        'bg-surface border-line @container border-b px-3 py-2',
        sticky && 'z-sticky sticky top-0',
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-2 @md:flex-row @md:items-start @md:justify-between @md:gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-serif text-base font-medium">{title}</h3>
          {detail === undefined ? null : <div className="text-ink-muted text-xs">{detail}</div>}
        </div>
        {actions === undefined ? null : <div className="flex shrink-0 gap-1">{actions}</div>}
      </div>
    </header>
  );
}
