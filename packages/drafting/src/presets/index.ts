import { FormatPresetSchema, type CourtPreset } from '@causedeck/validators/drafting';

import { karnatakaHc } from './karnataka-hc';
import { madrasHc, type CourtFormatPreset } from './madras-hc';

export { karnatakaHc, madrasHc };
export { MADRAS_HC_MAX_EXPORT_BYTES, type CourtFormatPreset } from './madras-hc';

export const PRESETS: Readonly<Partial<Record<CourtPreset, CourtFormatPreset>>> = {
  madras_hc: madrasHc,
  karnataka_hc: karnatakaHc,
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
