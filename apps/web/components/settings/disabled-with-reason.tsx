'use client';
// A settings action that may be unavailable (#288, #25 design spec): the export and danger-zone
// buttons. When there is a reason (the flow is not built yet, or the browser is offline) the button
// is disabled and the reason is a tooltip on a focusable wrapper, so keyboard and screen-reader
// users reach it too (a disabled button takes no focus), and the button names the same text with
// `aria-describedby`. Without a reason it is the plain action: a link when `href` is set.
import { Button, type ButtonVariant } from '@causedeck/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@causedeck/ui/tooltip';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { useOnline } from './settings-offline-banner.tsx';

export interface DisabledWithReasonProps {
  /** Base id: the reason text is `${id}-reason`. */
  id: string;
  /** Why the control is disabled; `null` when it is available. */
  reason: string | null;
  /** The disabled control. */
  children: ReactNode;
}

export function disabledReasonId(id: string): string {
  return `${id}-reason`;
}

/** Wraps a disabled control in a focusable tooltip trigger that explains why. */
export function DisabledWithReason({ id, reason, children }: DisabledWithReasonProps) {
  if (reason === null) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          data-slot="disabled-with-reason"
          data-disabled-reason={reason}
          className="focus-visible:outline-ring inline-flex w-full rounded-md focus-visible:outline-2 md:w-auto"
        >
          {children}
          <span id={disabledReasonId(id)} className="sr-only">
            {reason}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export interface SettingsActionProps {
  id: string;
  label: ReactNode;
  variant?: ButtonVariant;
  /** Why the action is unavailable; `null` when the flow exists. Offline adds its own reason. */
  reason: string | null;
  /** The reason shown while offline (`Settings can be changed when you are back online.`). */
  offlineReason: string;
  /** A link target when the action navigates to its flow. */
  href?: string;
  /** Extra `aria-describedby` ids (e.g. the row description). */
  describedBy?: string;
  /** `data-slot` for the enabled action, the hook the flow attaches to. */
  slot?: string;
}

/** A settings button that is disabled with an explained reason, or the working action. */
export function SettingsAction({
  id,
  label,
  variant = 'secondary',
  reason,
  offlineReason,
  href,
  describedBy,
  slot,
}: SettingsActionProps) {
  const online = useOnline();
  const why = reason ?? (online ? null : offlineReason);
  if (why !== null) {
    return (
      <DisabledWithReason id={id} reason={why}>
        <Button
          id={id}
          variant={variant}
          disabled
          aria-describedby={[describedBy, disabledReasonId(id)].filter(Boolean).join(' ')}
          className="w-full md:w-auto"
        >
          {label}
        </Button>
      </DisabledWithReason>
    );
  }
  if (href !== undefined) {
    return (
      <Button asChild variant={variant} aria-describedby={describedBy} className="w-full md:w-auto">
        <Link id={id} href={href} data-slot={slot}>
          {label}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      id={id}
      variant={variant}
      aria-describedby={describedBy}
      data-slot={slot}
      className="w-full md:w-auto"
    >
      {label}
    </Button>
  );
}
