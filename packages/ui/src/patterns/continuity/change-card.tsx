import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export interface ChangeCardItem {
  id: string;
  text: string;
  /** Provenance and actor, e.g. `Order, p. 2 · by Asha`. */
  detail?: string | undefined;
}

export interface ChangeCardGroup {
  day: string;
  items: readonly ChangeCardItem[];
}

export interface ChangeCardProps extends Omit<ComponentProps<'section'>, 'children' | 'title'> {
  /** e.g. `Since you last opened this, 12 days ago`. */
  heading: string;
  groups: readonly ChangeCardGroup[];
  /** Shown when nothing changed. */
  emptyLabel: string;
  dismissLabel: string;
  onDismiss: () => void;
}

/** The what-changed card for a returning viewer; chronological day groups. Not rendered on a first-ever view. */
export function ChangeCard({
  heading,
  groups,
  emptyLabel,
  dismissLabel,
  onDismiss,
  className,
  ...props
}: ChangeCardProps) {
  return (
    <section
      data-slot="change-card"
      aria-label={heading}
      className={cn('border-line grid gap-2 rounded-md border p-3', className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-medium">{heading}</h2>
        <button
          type="button"
          onClick={onDismiss}
          className="focus-visible:ring-ring min-h-11 rounded-md px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {dismissLabel}
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      ) : (
        groups.map((group) => (
          <div key={group.day} className="grid gap-1">
            <h3 className="text-muted-foreground text-xs">{group.day}</h3>
            <ul className="grid list-none gap-1 p-0">
              {group.items.map((item) => (
                <li key={item.id} className="text-sm break-words">
                  {item.text}
                  {item.detail === undefined ? null : (
                    <span className="text-muted-foreground block text-xs">{item.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
