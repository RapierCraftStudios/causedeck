// Swipe with keyboard parity (#68): swipe right opens Done (the close dialog), swipe left opens
// Reschedule; the keys `d` and `r` on a focused row do the same. A short drag is neither.
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export const SWIPE_DISTANCE_PX = 72;

export type SwipeAction = 'done' | 'reschedule';

export function swipeAction(dx: number, threshold = SWIPE_DISTANCE_PX): SwipeAction | null {
  if (dx >= threshold) return 'done';
  if (dx <= -threshold) return 'reschedule';
  return null;
}

export function keyAction(key: string): SwipeAction | null {
  if (key === 'd') return 'done';
  if (key === 'r') return 'reschedule';
  return null;
}

export interface UseSwipeOptions {
  onAction: (action: SwipeAction) => void;
  /** Pointer swipes only on touch; the keys always work. */
  touch?: boolean;
  disabled?: boolean;
}

export function useSwipe({ onAction, touch = true, disabled = false }: UseSwipeOptions) {
  const start = useRef<number | null>(null);
  return {
    onPointerDown: (event: PointerEvent) => {
      if (disabled || !touch || event.pointerType === 'mouse') return;
      start.current = event.clientX;
    },
    onPointerUp: (event: PointerEvent) => {
      if (start.current === null) return;
      const action = swipeAction(event.clientX - start.current);
      start.current = null;
      if (action !== null) onAction(action);
    },
    onPointerCancel: () => {
      start.current = null;
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]') !== null) return;
      const action = keyAction(event.key);
      if (action === null) return;
      // The queue's own key handler skips a key that was already handled.
      event.preventDefault();
      onAction(action);
    },
  };
}
