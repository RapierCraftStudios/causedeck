'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

export interface ConfirmBarProps extends Omit<ComponentProps<'div'>, 'children'> {
  confirmLabel: string;
  /** Why Confirm is disabled, read by assistive tech through `aria-describedby`; absent when ready. */
  blockedReason?: string | undefined;
  pending?: boolean | undefined;
  /** The action's shortcut as a hint, for example `Ctrl Enter`. */
  shortcut?: string | undefined;
  /** An offline note or error shown beside the button. */
  note?: ReactNode;
  /** Announced politely when the outcome of the action changes. */
  status?: string | undefined;
  onConfirm: () => void;
  secondary?: ReactNode;
}

/** The bar that applies the decisions; disabled while something still needs a human action. */
export function ConfirmBar({
  confirmLabel,
  blockedReason,
  pending = false,
  shortcut,
  note,
  status,
  onConfirm,
  secondary,
  className,
  ...props
}: ConfirmBarProps) {
  const reasonId = useId();
  const blocked = blockedReason !== undefined;
  return (
    <div
      data-slot="confirm-bar"
      className={cn(
        'border-border bg-background sticky bottom-0 flex flex-wrap items-center gap-3 border-t p-3',
        className,
      )}
      {...props}
    >
      <Button
        type="button"
        disabled={blocked || pending}
        aria-describedby={blocked ? reasonId : undefined}
        aria-keyshortcuts={shortcut === undefined ? undefined : 'Control+Enter Meta+Enter'}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
      {secondary}
      {blocked ? (
        <p id={reasonId} className="text-muted-foreground text-sm">
          {blockedReason}
        </p>
      ) : null}
      {shortcut === undefined ? null : (
        <span className="text-muted-foreground hidden text-xs md:inline">{shortcut}</span>
      )}
      {note}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}
