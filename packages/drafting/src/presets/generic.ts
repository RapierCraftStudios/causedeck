import type { CourtFormatPreset } from './madras-hc';

/** Forum-neutral format for A0 forums and templates not tied to a court: plain A4 with page numbers. */
export const genericPreset: CourtFormatPreset = {
  key: 'generic',
  pageSize: 'A4',
  marginsMm: { top: 25, right: 25, bottom: 25, left: 25 },
  fontFamily: 'Times New Roman',
  fontSizePt: 12,
  lineSpacing: 1.5,
  pageNumbering: 'footer_center',
};
