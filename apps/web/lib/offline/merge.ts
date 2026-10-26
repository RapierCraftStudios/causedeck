// Field-level three-way merge for brief state edited offline (#65 part 4, #745). `base` is what the
// client last saw when the edit began, `local` is the offline edit, `server` is a fresh pull. A
// field changed on one side takes that side; the same field changed to different values on both is
// a conflict returned with both values for a side-by-side choice, and the merged value keeps the
// server's until the user chooses. Nothing is dropped silently. Last-writer-wins is only for
// non-critical text (`lww`), and always carries a notice.

export interface BriefState {
  note: string | null;
  prepared: boolean;
  /** Carry items by key: `ticked` per item. */
  carry: Record<string, boolean>;
}

export type BriefField = 'note' | 'prepared' | `carry:${string}`;

export interface FieldConflict {
  field: BriefField;
  local: unknown;
  server: unknown;
}

export interface MergeResult {
  merged: BriefState;
  conflicts: FieldConflict[];
  /** Fields where last-writer-wins replaced a value; the UI must say so. */
  notices: BriefField[];
}

export interface MergeOptions {
  /** Fields that are non-critical text: the local (later) write wins, with a notice. */
  lww?: readonly BriefField[];
}

function pick<T>(
  field: BriefField,
  base: T,
  local: T,
  server: T,
  out: MergeResult,
  lww: readonly BriefField[],
): T {
  if (Object.is(local, server)) return local;
  if (Object.is(local, base)) return server;
  if (Object.is(server, base)) return local;
  if (lww.includes(field)) {
    out.notices.push(field);
    return local;
  }
  out.conflicts.push({ field, local, server });
  return server;
}

export function mergeBrief(
  base: BriefState,
  local: BriefState,
  server: BriefState,
  options: MergeOptions = {},
): MergeResult {
  const lww = options.lww ?? [];
  const out: MergeResult = {
    merged: { note: null, prepared: false, carry: {} },
    conflicts: [],
    notices: [],
  };
  out.merged.note = pick('note', base.note, local.note, server.note, out, lww);
  out.merged.prepared = pick('prepared', base.prepared, local.prepared, server.prepared, out, lww);
  const keys = new Set([
    ...Object.keys(base.carry),
    ...Object.keys(local.carry),
    ...Object.keys(server.carry),
  ]);
  for (const k of keys) {
    const value = pick(`carry:${k}`, base.carry[k], local.carry[k], server.carry[k], out, lww);
    if (value !== undefined) out.merged.carry[k] = value;
  }
  return out;
}

/** Apply the user's choice for a conflicted field to a merge result. */
export function resolveConflict(
  result: MergeResult,
  field: BriefField,
  take: 'local' | 'server',
): BriefState {
  const conflict = result.conflicts.find((c) => c.field === field);
  const merged = { ...result.merged, carry: { ...result.merged.carry } };
  if (!conflict) return merged;
  const value = take === 'local' ? conflict.local : conflict.server;
  if (field === 'note') merged.note = value as string | null;
  else if (field === 'prepared') merged.prepared = value as boolean;
  else {
    const name = field.slice(6);
    const rest = Object.fromEntries(Object.entries(merged.carry).filter(([k]) => k !== name));
    merged.carry = value === undefined ? rest : { ...rest, [name]: value as boolean };
  }
  return merged;
}
