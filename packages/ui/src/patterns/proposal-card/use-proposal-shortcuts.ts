// Group-scoped proposal shortcuts (#143). Unlike `useHotkey`, nothing listens on the document: the
// handler is bound to the group element, so the keys only work while focus is inside the group.
import { useCallback, type KeyboardEvent } from 'react';

import { isTypingTarget } from '../../hooks/use-hotkey';

export type ProposalAction = 'confirm' | 'edit' | 'dismiss';
export type ProposalShortcut = ProposalAction | 'next' | 'previous';

/** `aria-keyshortcuts` values (space-separated alternatives) and the `Kbd` hint for each action. */
export const PROPOSAL_SHORTCUTS: Record<ProposalShortcut, { aria: string; hint: string }> = {
  confirm: { aria: 'Enter', hint: 'enter' },
  edit: { aria: 'E', hint: 'e' },
  dismiss: { aria: 'Backspace X', hint: 'x' },
  next: { aria: 'J', hint: 'j' },
  previous: { aria: 'K', hint: 'k' },
};

/** Marks a card root (`data-proposal-id`) and its action buttons (`data-proposal-action`). */
export const CARD_SELECTOR = '[data-proposal-id]';
export const actionSelector = (action: ProposalAction): string =>
  `[data-proposal-action="${action}"]`;

interface ShortcutEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  target: unknown;
}

/**
 * The shortcut a key press means, or null. `card` is the card root the event came from. Enter only
 * confirms from the card itself, so Enter on a focused Edit or Dismiss button still presses it.
 */
export function proposalShortcut(
  event: ShortcutEventLike,
  card: Element | null,
): ProposalShortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;
  if (isTypingTarget(event.target)) return null;
  switch (event.key.toLowerCase()) {
    case 'j':
      return 'next';
    case 'k':
      return 'previous';
    case 'enter':
      return card && event.target === card ? 'confirm' : null;
    case 'e':
      return card ? 'edit' : null;
    case 'backspace':
    case 'x':
      return card ? 'dismiss' : null;
    default:
      return null;
  }
}

/** Press a card's action button, so disabled (offline) and hidden (view-only) actions stay inert. */
export function runProposalAction(card: Element, action: ProposalAction): boolean {
  const button = card.querySelector<HTMLButtonElement>(actionSelector(action));
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

export interface UseProposalShortcutsOptions {
  /** Move focus to the next (`1`) or previous (`-1`) card, from the card that has focus. */
  onMove: (from: Element | null, step: 1 | -1) => void;
}

/** `onKeyDown` for the group element: `J`/`K` between cards, `Enter`/`E`/`Backspace`/`X` act. */
export function useProposalShortcuts({
  onMove,
}: UseProposalShortcutsOptions): (event: KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const target = event.target as Element;
      const card = target.closest(CARD_SELECTOR);
      const shortcut = proposalShortcut(event, card);
      if (!shortcut) return;
      if (shortcut === 'next' || shortcut === 'previous') {
        event.preventDefault();
        onMove(card, shortcut === 'next' ? 1 : -1);
        return;
      }
      if (card && runProposalAction(card, shortcut)) event.preventDefault();
    },
    [onMove],
  );
}
