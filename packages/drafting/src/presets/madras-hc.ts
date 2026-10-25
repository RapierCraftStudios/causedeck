import type { FormatPreset } from '@causedeck/validators/drafting';

export type CourtFormatPreset = FormatPreset & {
  /** Largest export the court's e-filing accepts, in bytes. */
  maxExportBytes?: number;
};

export const MADRAS_HC_MAX_EXPORT_BYTES = 20 * 1024 * 1024;

export const madrasHcPreset: CourtFormatPreset = {
  key: 'madras_hc',
  pageSize: 'A4',
  marginsMm: { top: 25, right: 25, bottom: 25, left: 38 },
  fontFamily: 'Times New Roman',
  fontSizePt: 14,
  lineSpacing: 1.5,
  pageNumbering: 'footer_center',
  maxExportBytes: MADRAS_HC_MAX_EXPORT_BYTES,
};
