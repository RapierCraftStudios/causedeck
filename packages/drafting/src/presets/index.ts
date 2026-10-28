import { FormatPresetSchema, type CourtPreset } from '@causedeck/validators/drafting';

import { genericPreset } from './generic';
import { karnatakaHcPreset } from './karnataka-hc';
import { madrasHcPreset, type CourtFormatPreset } from './madras-hc';

export { genericPreset as generic, karnatakaHcPreset as karnatakaHc, madrasHcPreset as madrasHc };
export { MADRAS_HC_MAX_EXPORT_BYTES, type CourtFormatPreset } from './madras-hc';

export const PRESETS: Readonly<Partial<Record<CourtPreset, CourtFormatPreset>>> = {
  generic: genericPreset,
  madras_hc: madrasHcPreset,
  karnataka_hc: karnatakaHcPreset,
};

/** The preset for a court key, or undefined when none is defined yet. */
export function getPreset(key: CourtPreset): CourtFormatPreset | undefined {
  return PRESETS[key];
}

/** Checks a preset against the shared schema (the extra size cap is not part of it). */
export function isValidPreset(preset: CourtFormatPreset): boolean {
  const { key, pageSize, marginsMm, fontFamily, fontSizePt, lineSpacing, pageNumbering } = preset;
  return FormatPresetSchema.safeParse({
    key,
    pageSize,
    marginsMm,
    fontFamily,
    fontSizePt,
    lineSpacing,
    pageNumbering,
  }).success;
}
