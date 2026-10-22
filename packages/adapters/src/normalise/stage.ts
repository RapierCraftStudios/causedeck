// Stage normaliser (#369). Stages are an open enum: an adapter's `stageMap` maps heading regexes to
// normalised keys, the first match wins, and an unknown heading is kept verbatim with a null key so
// the caller can count it in `diagnostics.unmappedHeadings`. Nothing here throws on a heading.
import type { StageMapEntry } from '../config/schema.ts';

export interface NormalisedStage {
  /** The heading exactly as printed. */
  stageRaw: string;
  stageNorm: string | null;
}

const compiled = new WeakMap<StageMapEntry, RegExp | null>();

function regexOf(entry: StageMapEntry): RegExp | null {
  let regex = compiled.get(entry);
  if (regex === undefined) {
    try {
      regex = new RegExp(entry.pattern, entry.flags);
    } catch {
      regex = null;
    }
    compiled.set(entry, regex);
  }
  return regex;
}

/** Map a heading to its stage key; `stageNorm` is null when no pattern matches. */
export function normaliseStage(
  heading: string,
  stageMap: readonly StageMapEntry[],
): NormalisedStage {
  const text = heading.trim().replace(/\s+/g, ' ');
  for (const entry of stageMap) {
    const regex = regexOf(entry);
    if (regex?.test(text) === true) return { stageRaw: heading, stageNorm: entry.key };
  }
  return { stageRaw: heading, stageNorm: null };
}
