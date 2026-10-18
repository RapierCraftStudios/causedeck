import { Undo2 } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';

import { Button } from '../../components/button';
import { toast } from '../../components/sonner';
import { cn } from '../../lib/cn';

/** How long an applied (L3) change can be undone. */
export const UNDO_WINDOW_DAYS = 7;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface UndoWindow {
  expired: boolean;
  /** Whole days left (0 on the last day). */
  remainingDays: number;
  /** Hours left, rounded up, for the last day. */
  remainingHours: number;
  endsAt: Date;
}

/** Where `now` falls in the undo window that opened at `performedAt`. Pure, for tests and stories. */
export function undoWindow(
  performedAt: Date | string,
  now: Date,
  days: number = UNDO_WINDOW_DAYS,
): UndoWindow {
  const endsAt = new Date(new Date(performedAt).getTime() + days * DAY_MS);
  const remaining = endsAt.getTime() - now.getTime();
  return {
    expired: remaining <= 0,
    remainingDays: Math.max(0, Math.floor(remaining / DAY_MS)),
    remainingHours: Math.max(0, Math.ceil(remaining / HOUR_MS)),
    endsAt,
  };
}

export interface UndoLabels {
  undo: string;
  redo: string;
  /** Countdown next to the button: `Undo available for 6 days`. */
  available: (window: UndoWindow) => string;
  /** Replaces the button once the window has closed. */
  ended: string;
  /** Toast title and live-region announcement after undoing. */
  undone: string;
  /** Live-region announcement after Redo. */
  redone: string;
  /** Why Undo is disabled while offline. */
  offline: string;
}

const plural = (n: number, unit: string) => `${String(n)} ${unit}${n === 1 ? '' : 's'}`;

export const DEFAULT_UNDO_LABELS: UndoLabels = {
  undo: 'Undo',
  redo: 'Redo',
  available: ({ remainingDays, remainingHours }) =>
    `Undo available for ${
      remainingDays >= 1 ? plural(remainingDays, 'day') : plural(remainingHours, 'hour')
    }`,
  ended: 'Undo window ended',
  undone: 'Undone',
  redone: 'Restored',
  offline: 'You are offline. Undo when you are back online.',
};

export interface UndoButtonProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** When the change was applied; the window runs `windowDays` from here. */
  performedAt: Date | string;
  /** Current time. Pass a fixed date in stories and tests. */
  now?: Date | undefined;
  windowDays?: number | undefined;
  /** The change has been undone: the button gives way to the live region only. */
  undone?: boolean | undefined;
  onUndo?: (() => void) | undefined;
  onRedo?: (() => void) | undefined;
  /** Toast description, e.g. the activity sentence. */
  description?: string | undefined;
  /** Read-only: Undo is disabled with the reason. */
  offline?: boolean | undefined;
  labels?: Partial<UndoLabels> | undefined;
}

/**
 * Undo for an applied change: a countdown of the 7-day window, then `Undo window ended`. Undoing
 * shows a toast with Redo and announces `Undone` in a polite live region.
 */
export function UndoButton({
  performedAt,
  now,
  windowDays = UNDO_WINDOW_DAYS,
  undone = false,
  onUndo,
  onRedo,
  description,
  offline = false,
  labels,
  className,
  ...props
}: UndoButtonProps) {
  const text = { ...DEFAULT_UNDO_LABELS, ...labels };
  const [announcement, setAnnouncement] = useState('');
  const hintId = useId();
  const state = undoWindow(performedAt, now ?? new Date(), windowDays);

  const undo = () => {
    onUndo?.();
    setAnnouncement(text.undone);
    toast(text.undone, {
      description,
      action: {
        label: text.redo,
        onClick: () => {
          onRedo?.();
          setAnnouncement(text.redone);
        },
      },
    });
  };

  let control = null;
  if (state.expired) {
    control = (
      <span data-slot="undo-ended" className="text-ink-subtle font-sans text-xs">
        {text.ended}
      </span>
    );
  } else if (!undone) {
    control = (
      <>
        <span id={hintId} data-slot="undo-countdown" className="text-ink-muted font-sans text-xs">
          {offline ? text.offline : text.available(state)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-slot="undo-button"
          aria-describedby={hintId}
          disabled={offline}
          onClick={undo}
        >
          <Undo2 aria-hidden="true" />
          {text.undo}
        </Button>
      </>
    );
  }

  return (
    <div
      data-slot="undo"
      data-expired={state.expired ? '' : undefined}
      className={cn('flex shrink-0 items-center gap-2', className)}
      {...props}
    >
      {control}
      <span role="status" aria-live="polite" data-slot="undo-live" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
