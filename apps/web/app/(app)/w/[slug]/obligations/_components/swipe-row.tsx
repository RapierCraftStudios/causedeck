'use client';
// Wraps a row so the swipe actions also work from the keyboard (#68): `d` and `r` on the focused
// row. The pointer swipe itself is the `ObligationRow` pattern's, so this wrapper listens only
// for keys and leaves pointer events to the row.
import type { ReactNode } from 'react';

import { useSwipe, type SwipeAction } from './use-swipe.ts';

export interface SwipeRowProps {
  children: ReactNode;
  disabled?: boolean;
  onAction: (action: SwipeAction) => void;
}

export function SwipeRow({ children, disabled = false, onAction }: SwipeRowProps) {
  const { onKeyDown } = useSwipe({ onAction, disabled, touch: false });
  return (
    <div data-slot="obligation-swipe-row" onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
