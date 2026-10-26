'use client';
// The Undo toast after a merge or a split (#392, #40 part 4): a toast with `Undo` for 10 seconds
// that calls the inverse with the `UndoPayload` the operation returned. The payload lives only in
// this closure (durable storage is #47). `Undo` runs once; a CONFLICT (something moved since)
// says nothing was undone. Results also go to the matter's polite live region.
import { toast } from '@causedeck/ui/sonner';

import type { Result } from '../../lib/safe-action.ts';

/** How long `Undo` is offered. */
export const UNDO_WINDOW_MS = 10_000;

export interface UndoToastLabels {
  action: string;
  done: string;
  conflict: string;
  failed: string;
}

export interface ShowUndoToastOptions {
  message: string;
  undo: () => Promise<Result<unknown>>;
  labels: UndoToastLabels;
  announce?: (message: string) => void;
  /** After a successful undo, e.g. `router.refresh()`. */
  onUndone?: () => void;
}

/** Show the toast; returns its id. */
export function showUndoToast({
  message,
  undo,
  labels,
  announce,
  onUndone,
}: ShowUndoToastOptions): string | number {
  let used = false;
  return toast.success(message, {
    duration: UNDO_WINDOW_MS,
    action: {
      label: labels.action,
      onClick: () => {
        if (used) return;
        used = true;
        void (async () => {
          let result: Result<unknown>;
          try {
            result = await undo();
          } catch {
            result = { ok: false, error: { code: 'INTERNAL', message: '' } };
          }
          if (result.ok) {
            toast.success(labels.done);
            announce?.(labels.done);
            onUndone?.();
            return;
          }
          const text = result.error.code === 'CONFLICT' ? labels.conflict : labels.failed;
          toast.error(text);
          announce?.(text);
        })();
      },
    },
  });
}
