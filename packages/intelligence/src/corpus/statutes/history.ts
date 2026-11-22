// Statute section history (#1116, ADR 0051): which version of a section was in force on a date.
// Pure functions over plain rows; the rows come from `statute_section_version` (#1123) or a fixture.

/** One version of a section's text, valid over the half-open range `[valid_from, valid_to)`. */
export interface SectionVersion {
  text: string;
  /** ISO `YYYY-MM-DD`: the first day this text was in force. */
  valid_from: string;
  /** ISO `YYYY-MM-DD`: the first day this text was no longer in force; null while it still is. */
  valid_to: string | null;
  amended_by?: string | null;
  source_note?: string | null;
}

function covers(version: SectionVersion, onDate: string): boolean {
  return version.valid_from <= onDate && (version.valid_to === null || onDate < version.valid_to);
}

/**
 * The version in force on `onDate` (ISO `YYYY-MM-DD`): `valid_from <= onDate < valid_to`, so on the
 * day an amendment takes effect the amended text applies. Null when no version covers the date.
 * The order of `versions` does not matter; with overlapping (invalid) data the latest start wins.
 */
export function sectionAt<T extends SectionVersion>(
  versions: readonly T[],
  onDate: string,
): T | null {
  let found: T | null = null;
  for (const version of versions) {
    if (!covers(version, onDate)) continue;
    if (found === null || version.valid_from > found.valid_from) found = version;
  }
  return found;
}

export interface SectionHistory<T extends SectionVersion> {
  /** The versions ordered by `valid_from`, oldest first. */
  versions: T[];
  /** Pairs of versions whose half-open ranges intersect: a data error a caller must reject. */
  overlaps: [T, T][];
}

function overlap(a: SectionVersion, b: SectionVersion): boolean {
  const aEndsAfterB = a.valid_to === null || a.valid_to > b.valid_from;
  const bEndsAfterA = b.valid_to === null || b.valid_to > a.valid_from;
  return aEndsAfterB && bEndsAfterA;
}

/** A section's versions oldest first, with any overlapping validity ranges reported. */
export function sectionHistory<T extends SectionVersion>(
  versions: readonly T[],
): SectionHistory<T> {
  const sorted = [...versions].sort((a, b) =>
    a.valid_from < b.valid_from ? -1 : a.valid_from > b.valid_from ? 1 : 0,
  );
  const overlaps: [T, T][] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (a !== undefined && b !== undefined && overlap(a, b)) overlaps.push([a, b]);
    }
  }
  return { versions: sorted, overlaps };
}
