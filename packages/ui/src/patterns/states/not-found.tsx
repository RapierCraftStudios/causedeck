import { SearchX } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/button';
import { EmptyState } from '../../components/empty-state';

export const NOT_FOUND_COPY = 'We could not find this. It may have been moved or removed.';

export interface NotFoundProps extends Omit<ComponentProps<'div'>, 'title' | 'children'> {
  message?: string | undefined;
  /** The one way out, e.g. `Back to matters`. */
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}

/** A link or record that no longer exists: one calm sentence and one way back. */
export function NotFound({
  message = NOT_FOUND_COPY,
  actionLabel,
  onAction,
  ...props
}: NotFoundProps) {
  return (
    <EmptyState
      data-pattern-state="not-found"
      icon={<SearchX />}
      title={message}
      action={
        actionLabel !== undefined && onAction ? (
          <Button onClick={onAction}>{actionLabel}</Button>
        ) : undefined
      }
      {...props}
    />
  );
}
