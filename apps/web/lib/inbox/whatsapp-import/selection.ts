// Selection rules of the preview (#527). A message that trips a rule starts out held back: it is
// in the selection only after a per-message confirmation, and never when the rule cannot be
// released (Aadhaar numbers and credentials). Pure, so the list and its tests share it.
import { isReleasable, MAX_IMPORT_MESSAGES } from './payload.ts';
import type { ImportRow } from './types.ts';

export const isHeld = (row: ImportRow): boolean => row.rules.length > 0;

/** Everything that is not held starts selected, up to the import limit. */
export function initialSelection(rows: readonly ImportRow[]): Set<string> {
  const selected = new Set<string>();
  for (const row of rows) {
    if (!isHeld(row) && selected.size < MAX_IMPORT_MESSAGES) selected.add(row.id);
  }
  return selected;
}

export function matchesSearch(row: ImportRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return row.text.toLowerCase().includes(needle) || row.sender.toLowerCase().includes(needle);
}

/** Toggle one message. A held message can only be toggled once confirmed. */
export function toggle(
  selected: ReadonlySet<string>,
  confirmed: ReadonlySet<string>,
  row: ImportRow,
): Set<string> {
  const next = new Set(selected);
  if (next.has(row.id)) next.delete(row.id);
  else if (!isHeld(row) || confirmed.has(row.id)) next.add(row.id);
  return next;
}

/** Confirm (or take back the confirmation of) a held message. */
export function confirmHeld(
  selected: ReadonlySet<string>,
  confirmed: ReadonlySet<string>,
  row: ImportRow,
): { selected: Set<string>; confirmed: Set<string> } {
  const nextSelected = new Set(selected);
  const nextConfirmed = new Set(confirmed);
  if (!isHeld(row) || !isReleasable(row))
    return { selected: nextSelected, confirmed: nextConfirmed };
  if (nextConfirmed.has(row.id)) {
    nextConfirmed.delete(row.id);
    nextSelected.delete(row.id);
  } else if (nextSelected.size < MAX_IMPORT_MESSAGES) {
    nextConfirmed.add(row.id);
    nextSelected.add(row.id);
  }
  return { selected: nextSelected, confirmed: nextConfirmed };
}

/** Select every shown message that may be imported, up to the limit. */
export function selectShown(
  selected: ReadonlySet<string>,
  confirmed: ReadonlySet<string>,
  shown: readonly ImportRow[],
): Set<string> {
  const next = new Set(selected);
  for (const row of shown) {
    if (next.size >= MAX_IMPORT_MESSAGES) break;
    if (!isHeld(row) || confirmed.has(row.id)) next.add(row.id);
  }
  return next;
}

export function clearShown(
  selected: ReadonlySet<string>,
  shown: readonly ImportRow[],
): Set<string> {
  const next = new Set(selected);
  for (const row of shown) next.delete(row.id);
  return next;
}

/** Bulk exclusion: take every held message back out, undoing confirmations. */
export function excludeHeld(
  selected: ReadonlySet<string>,
  rows: readonly ImportRow[],
): { selected: Set<string>; confirmed: Set<string> } {
  const next = new Set(selected);
  for (const row of rows) if (isHeld(row)) next.delete(row.id);
  return { selected: next, confirmed: new Set() };
}
