import { AlertTriangle, Clock, UserRound } from 'lucide-react';
import { useId, useState, type ComponentProps, type KeyboardEvent } from 'react';

import { Button } from '../../components/button';
import { Skeleton } from '../../components/skeleton';
import { cn } from '../../lib/cn';

export interface AssigneeOption {
  id: string;
  name: string;
}

export type AssignmentFlag = 'unassigned' | 'clash';
export type AssignmentSync = 'synced' | 'queued';

export interface AssignmentRowLabels {
  assignee: string;
  assign: string;
  choose: string;
  unassigned: string;
  clash: string;
  willSync: string;
  suggestion: (name: string) => string;
}

export const DEFAULT_ASSIGNMENT_ROW_LABELS: AssignmentRowLabels = {
  assignee: 'Assignee',
  assign: 'Assign',
  choose: 'Choose a member',
  unassigned: 'Unassigned',
  clash: 'Clash',
  willSync: 'Will sync',
  suggestion: (name) => `Suggested: ${name}`,
};

export interface AssignmentRowProps extends Omit<ComponentProps<'li'>, 'children' | 'onSelect'> {
  /** Item number and matter, e.g. `12 · Rao v. State`. */
  title: string;
  /** Case label and hall, one line. */
  detail?: string | undefined;
  members: readonly AssigneeOption[];
  assigneeId: string | null;
  flag?: AssignmentFlag | undefined;
  sync?: AssignmentSync | undefined;
  /** The proposal for this row and why, shown above the picker; the owner accepts it by assigning. */
  suggestion?: { memberId: string; reason: string } | undefined;
  disabled?: boolean | undefined;
  onAssign: (memberId: string) => void;
  labels?: Partial<AssignmentRowLabels> | undefined;
}

/**
 * One appearance in the tomorrow plan: who holds it and a picker. Press `a` on the focused row to
 * open the picker, arrow keys choose, `Enter` assigns. Targets are 44 px.
 */
export function AssignmentRow({
  title,
  detail,
  members,
  assigneeId,
  flag,
  sync = 'synced',
  suggestion,
  disabled = false,
  onAssign,
  labels,
  className,
  ...props
}: AssignmentRowProps) {
  const text = { ...DEFAULT_ASSIGNMENT_ROW_LABELS, ...labels };
  const selectId = useId();
  const [pending, setPending] = useState<string>(suggestion?.memberId ?? assigneeId ?? '');
  const assignee = members.find((m) => m.id === assigneeId);
  const commit = () => {
    if (pending !== '' && !disabled) onAssign(pending);
  };
  const onRowKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget || disabled) return;
    if (event.key === 'a' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLSelectElement>('select')?.focus();
    }
  };
  return (
    <li
      data-slot="assignment-row"
      data-flag={flag}
      data-sync={sync}
      tabIndex={0}
      onKeyDown={onRowKeyDown}
      className={cn(
        'border-line bg-surface-raised focus-visible:ring-accent flex flex-col gap-2 rounded-md border p-3 outline-none focus-visible:ring-2',
        className,
      )}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        {flag === 'clash' ? (
          <span className="text-danger inline-flex items-center gap-1 text-xs">
            <AlertTriangle aria-hidden className="size-3.5" />
            {text.clash}
          </span>
        ) : null}
        {flag === 'unassigned' ? (
          <span className="text-ink-muted inline-flex items-center gap-1 text-xs">
            <UserRound aria-hidden className="size-3.5" />
            {text.unassigned}
          </span>
        ) : null}
        {sync === 'queued' ? (
          <span className="text-ink-muted inline-flex items-center gap-1 text-xs">
            <Clock aria-hidden className="size-3.5" />
            {text.willSync}
          </span>
        ) : null}
      </div>
      {detail === undefined ? null : <p className="text-ink-muted text-xs">{detail}</p>}
      {suggestion === undefined ? null : (
        <p data-slot="assignment-suggestion" className="text-xs">
          {text.suggestion(members.find((m) => m.id === suggestion.memberId)?.name ?? '')}
          {' · '}
          {suggestion.reason}
        </p>
      )}
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          {text.assignee}
        </label>
        <select
          id={selectId}
          value={pending}
          disabled={disabled}
          onChange={(event) => {
            setPending(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
          className="border-line-control bg-surface text-ink focus-visible:ring-accent min-h-11 min-w-0 flex-1 rounded-md border px-2 text-sm"
        >
          <option value="">{assignee?.name ?? text.choose}</option>
          {members
            .filter((m) => m.id !== assigneeId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
        <Button
          type="button"
          size="lg"
          className="min-w-11"
          disabled={disabled || pending === '' || pending === assigneeId}
          onClick={commit}
        >
          {text.assign}
        </Button>
      </div>
    </li>
  );
}

export function AssignmentRowSkeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col gap-2 p-3', className)} {...props}>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
