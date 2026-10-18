import { ClipboardCheck, Inbox, ListChecks } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/button';
import { EmptyState } from '../../components/empty-state';
import { ACTIVITY_EMPTY_COPY } from '../activity-item/activity-item';
import { OBLIGATION_EMPTY_COPY } from '../obligation-row/obligation-row';
import { DEFAULT_PROPOSAL_GROUP_LABELS } from '../proposal-card/proposal-card-group';

/** Empty copy per surface (spec #9 States): one calm sentence each, never an exclamation. */
export const PATTERN_EMPTY_COPY = {
  proposals: DEFAULT_PROPOSAL_GROUP_LABELS.empty,
  activity: ACTIVITY_EMPTY_COPY,
  obligations: OBLIGATION_EMPTY_COPY,
} as const;

export type PatternEmptyKind = keyof typeof PATTERN_EMPTY_COPY;

export const PATTERN_EMPTY_ICONS: Record<PatternEmptyKind, ReactNode> = {
  proposals: <ListChecks />,
  activity: <Inbox />,
  obligations: <ClipboardCheck />,
};

export interface PatternEmptyStateProps extends Omit<ComponentProps<'div'>, 'title' | 'children'> {
  /** Picks the spec copy and icon; `message` and `icon` override them. */
  kind?: PatternEmptyKind | undefined;
  /** One calm sentence. */
  message?: string | undefined;
  icon?: ReactNode;
  /** The single primary action, e.g. `Forward an order`. */
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}

/** Nothing to show: one calm sentence and at most one primary action. */
export function PatternEmptyState({
  kind,
  message,
  icon,
  actionLabel,
  onAction,
  ...props
}: PatternEmptyStateProps) {
  const title = message ?? (kind === undefined ? undefined : PATTERN_EMPTY_COPY[kind]) ?? '';
  return (
    <EmptyState
      data-pattern-state="empty"
      icon={icon ?? (kind === undefined ? undefined : PATTERN_EMPTY_ICONS[kind])}
      title={title}
      action={
        actionLabel !== undefined && onAction ? (
          <Button onClick={onAction}>{actionLabel}</Button>
        ) : undefined
      }
      {...props}
    />
  );
}
