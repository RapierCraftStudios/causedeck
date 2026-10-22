// Karnataka HC list headings (#404, seeded from practitioner usage in #405): assumed stage headings.
// Official output lists could not be read (research/raw/09 §1.2), so every pattern is an assumption
// the ADR (0019) retires with real lists (#119); unmatched headings stay verbatim in
// `unmappedHeadings` (open enum). The most specific pattern comes first: the first match wins.
// Rows under `orders` (registry objections) also carry `registryObjection: true`.
import type { StageMapEntry } from '../../config/schema.ts';

export const KARNATAKA_HC_STAGE_MAP: StageMapEntry[] = [
  {
    pattern: '^(?:FOR\\s+)?PRELIMINARY\\s+HEARING\\s*\\(\\s*B[\\s-]*GROUP\\s*\\)',
    flags: 'i',
    key: 'preliminary_hearing_b_group',
  },
  { pattern: '^(?:FOR\\s+)?PRELIMINARY\\s+HEARING\\b', flags: 'i', key: 'preliminary_hearing' },
  { pattern: '^(?:FOR\\s+)?HEARING\\s+ON\\s+I\\.?\\s?A\\b', flags: 'i', key: 'hearing_on_ia' },
  { pattern: '^(?:FOR\\s+)?ADMISSION\\b', flags: 'i', key: 'admission' },
  { pattern: '^(?:FOR\\s+)?BEING\\s+SPOKEN\\s+TO\\b', flags: 'i', key: 'being_spoken_to' },
  { pattern: '^(?:FOR\\s+)?ORDERS\\b', flags: 'i', key: 'orders' },
  { pattern: '^(?:FOR\\s+)?(?:FINAL\\s+)?HEARING\\b', flags: 'i', key: 'final_hearing' },
  { pattern: '^FRESH\\b', flags: 'i', key: 'fresh' },
  { pattern: '^(?:FOR\\s+)?(?:JUDGMENT|PRONOUNCEMENT)\\b', flags: 'i', key: 'judgment' },
  { pattern: '^(?:FOR\\s+)?(?:OFFICE\\s+)?OBJECTIONS?\\b', flags: 'i', key: 'objections' },
  { pattern: '^(?:FOR\\s+)?DICTATION\\b', flags: 'i', key: 'dictation' },
];
