// Roving focus and shortcuts of the court-day board (#59). Pure helpers: the controller binds them.

export interface BoardShortcut {
  keys: string;
  /** Message key under `courtDay.board.shortcuts`. */
  id:
    | 'nextItem'
    | 'previousItem'
    | 'nextHall'
    | 'previousHall'
    | 'open'
    | 'carry'
    | 'marker'
    | 'actions'
    | 'diff'
    | 'rail'
    | 'today'
    | 'matters'
    | 'help';
}

export const BOARD_SHORTCUTS: readonly BoardShortcut[] = [
  { keys: 'j', id: 'nextItem' },
  { keys: 'k', id: 'previousItem' },
  { keys: 'l', id: 'nextHall' },
  { keys: 'h', id: 'previousHall' },
  { keys: 'Enter', id: 'open' },
  { keys: 'c', id: 'carry' },
  { keys: 'm', id: 'marker' },
  { keys: 'o', id: 'actions' },
  { keys: 'd', id: 'diff' },
  { keys: '/', id: 'rail' },
  { keys: 'g then t', id: 'today' },
  { keys: 'g then m', id: 'matters' },
  { keys: '?', id: 'help' },
];

/** The index `delta` steps from `current`, clamped to the list; the first item when none is current. */
export function step(length: number, current: number, delta: 1 | -1): number {
  if (length === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return Math.min(length - 1, Math.max(0, current + delta));
}

/** Items of the focused hall's column, or of the whole board when no hall holds focus. */
export function itemsIn(root: ParentNode, within: Element | null): HTMLElement[] {
  const scope: ParentNode = within ?? root;
  return [...scope.querySelectorAll<HTMLElement>('[data-court-item]')];
}

export function hallColumns(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-hall-column]')].filter(
    (column) => column.offsetParent !== null,
  );
}

/** Focus `target` and make it the only tab stop among `all`. */
export function roveTo(all: readonly HTMLElement[], target: HTMLElement): void {
  for (const element of all) element.tabIndex = element === target ? 0 : -1;
  target.focus();
}
