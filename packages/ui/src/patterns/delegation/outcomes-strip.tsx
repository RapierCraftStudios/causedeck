import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export interface OutcomesStripMember {
  memberId: string;
  name: string;
  total: number;
  outcomesIn: number;
}

export interface OutcomesStripProps extends Omit<ComponentProps<'div'>, 'children'> {
  members: readonly OutcomesStripMember[];
  /** One line per member, e.g. `Asha: 2 of 5 outcomes in`. */
  format?: ((member: OutcomesStripMember) => string) | undefined;
  label?: string | undefined;
}

/** The owner's live strip: per delegated member, outcomes confirmed so far. Polite live region. */
export function OutcomesStrip({
  members,
  format = (m) => `${m.name}: ${String(m.outcomesIn)} of ${String(m.total)} outcomes in`,
  label = 'Outcomes',
  className,
  ...props
}: OutcomesStripProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-slot="outcomes-strip"
      className={cn(
        'border-line flex flex-wrap gap-x-4 gap-y-1 rounded-md border p-3 text-sm',
        className,
      )}
      {...props}
    >
      {members.map((m) => (
        <span key={m.memberId}>{format(m)}</span>
      ))}
    </div>
  );
}
