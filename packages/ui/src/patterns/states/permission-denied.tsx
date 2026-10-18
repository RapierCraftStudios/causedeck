import { Lock } from 'lucide-react';
import type { ComponentProps } from 'react';

import { EmptyState } from '../../components/empty-state';

export const PERMISSION_DENIED_COPY = 'You do not have access to this. Ask the workspace owner.';

export interface PermissionDeniedProps extends Omit<ComponentProps<'div'>, 'title' | 'children'> {
  message?: string | undefined;
}

/** No access: a lock and who to ask. No actions, nothing to retry. */
export function PermissionDenied({
  message = PERMISSION_DENIED_COPY,
  ...props
}: PermissionDeniedProps) {
  return (
    <EmptyState
      data-pattern-state="permission-denied"
      icon={<Lock data-slot="permission-denied-lock" />}
      title={message}
      {...props}
    />
  );
}
