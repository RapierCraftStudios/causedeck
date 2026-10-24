// The inbox's own shortcuts (#48). `j`, `k`, `Enter`, `e` and `x` belong to the cards
// (`useProposalShortcuts` in the ui patterns, bound to the list); these are the page-level ones:
// `u` undoes the last resolved item while its toast shows, `1`/`2`/`3` switch section and `?` opens
// the sheet. All of them are ignored while typing in a field and with a modifier held.
import { isTypingTarget } from '@causedeck/ui/hooks';

export type InboxSection = 'needsYou' | 'ready' | 'processing';

export const SECTIONS: readonly InboxSection[] = ['needsYou', 'ready', 'processing'];

export type InboxShortcut =
  { kind: 'undo' } | { kind: 'section'; section: InboxSection } | { kind: 'help' };

interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  target: unknown;
}

export function inboxShortcut(event: KeyEventLike): InboxShortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;
  if (isTypingTarget(event.target)) return null;
  switch (event.key) {
    case 'u':
      return { kind: 'undo' };
    case '1':
    case '2':
    case '3': {
      const section = SECTIONS[Number(event.key) - 1];
      return section === undefined ? null : { kind: 'section', section };
    }
    case '?':
      return { kind: 'help' };
    default:
      return null;
  }
}

/** Rows of the shortcut sheet: one key each (`useHotkey` syntax) and the `inbox.shortcuts.<id>` message. */
export const INBOX_SHORTCUT_ROWS = [
  { id: 'move', keys: 'j' },
  { id: 'move', keys: 'k' },
  { id: 'confirm', keys: 'enter' },
  { id: 'edit', keys: 'e' },
  { id: 'dismiss', keys: 'x' },
  { id: 'undo', keys: 'u' },
  { id: 'sections', keys: '1' },
  { id: 'sections', keys: '2' },
  { id: 'sections', keys: '3' },
  { id: 'help', keys: '?' },
] as const;
