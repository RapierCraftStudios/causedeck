import { UserRound } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export interface AssigneeChipProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** The assignee's name; absent means unassigned. */
  name?: string | undefined;
  unassignedLabel?: string | undefined;
}

/** Who holds an appearance, on the board and in lists. */
export function AssigneeChip({
  name,
  unassignedLabel = 'Unassigned',
  className,
  ...props
}: AssigneeChipProps) {
  return (
    <span
      data-slot="assignee-chip"
      data-assigned={name === undefined ? 'false' : 'true'}
      className={cn(
        'border-line inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
        name === undefined && 'text-ink-muted',
        className,
      )}
      {...props}
    >
      <UserRound aria-hidden className="size-3.5" />
      {name ?? unassignedLabel}
    </span>
  );
}
