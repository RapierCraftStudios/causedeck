// Shortcuts of the Brief Sheet (#61). Pure data and helpers; `use-brief-keyboard.tsx` binds them.
export interface BriefShortcut {
  keys: string;
  id: 'print' | 'prev' | 'next' | 'carry' | 'notes' | 'edit' | 'section' | 'close' | 'help';
}

export const BRIEF_SHORTCUTS: readonly BriefShortcut[] = [
  { keys: 'p', id: 'print' },
  { keys: '[', id: 'prev' },
  { keys: ']', id: 'next' },
  { keys: 'c', id: 'carry' },
  { keys: 'n', id: 'notes' },
  { keys: 'e', id: 'edit' },
  { keys: '1-9', id: 'section' },
  { keys: 'Esc', id: 'close' },
  { keys: '?', id: 'help' },
];

/** The id `delta` sections from the focused one, clamped; the first or last when none has focus. */
export function neighbour(
  ids: readonly string[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return delta === 1 ? (ids[0] ?? null) : (ids.at(-1) ?? null);
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))] ?? null;
}
