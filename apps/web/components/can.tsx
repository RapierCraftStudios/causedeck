'use client';
// `<Can action resource>` (#234): hides or disables UI by the central policy, through `useCan`
// from `@causedeck/auth/react` (the same `can()` the server enforces). UX only: server actions
// (`workspaceAction` / `guard`) and the API (`authorize`) always check again.
import { rolesFor, type Action, type Resource } from '@causedeck/auth/policy';
import { useCan } from '@causedeck/auth/react';
import { useTranslations } from 'next-intl';
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

export interface CanProps {
  action: Action;
  resource?: Resource;
  /** `hide` (default) renders `fallback` when denied; `disable` disables the child with a tooltip. */
  mode?: 'hide' | 'disable';
  fallback?: ReactNode;
  children: ReactNode;
}

/** Tooltip key for a denied action: who may do it, from the matrix's minimum role. */
export function deniedHintKey(action: Action): 'ownersOnly' | 'ownersAndAdvocates' | 'roleTooLow' {
  const allowed = rolesFor(action);
  if (allowed.length === 1 && allowed[0] === 'owner') return 'ownersOnly';
  if (allowed.length === 2 && allowed.includes('advocate')) return 'ownersAndAdvocates';
  return 'roleTooLow';
}

export function Can({ action, resource, mode = 'hide', fallback = null, children }: CanProps) {
  const decision = useCan(action, resource);
  const t = useTranslations('shell.permission');
  if (decision.allow) return children;
  if (mode === 'hide' || !isValidElement(children)) return fallback;
  const hint = t(deniedHintKey(action));
  const child = children as ReactElement<{ disabled?: boolean; 'aria-disabled'?: boolean }>;
  return (
    <span title={hint} data-slot="can-denied" className="inline-flex">
      {cloneElement(child, { disabled: true, 'aria-disabled': true })}
    </span>
  );
}
