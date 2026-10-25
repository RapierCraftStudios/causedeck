// Madras HC list headings (#395): the stage keys parent #36 names. Official heading strings were not
// observed (research/raw/08 §2 and implication 5), so every pattern is unverified and unmatched
// headings stay verbatim in `unmappedHeadings` (open enum).
import type { StageMapEntry } from '../../config/schema.ts';

export const MADRAS_HC_STAGE_MAP: StageMapEntry[] = [
  { pattern: '^(?:FOR\\s+)?ADMISSION\\b', flags: 'i', key: 'admission' },
  { pattern: '^(?:FOR\\s+)?ORDERS\\b', flags: 'i', key: 'orders' },
  { pattern: '^(?:FOR\\s+)?(?:FINAL\\s+)?HEARING\\b', flags: 'i', key: 'hearing' },
  { pattern: '^FRESH\\b|^NEW\\s+(?:CASES|ADMISSION)\\b', flags: 'i', key: 'fresh' },
  { pattern: '^AFTER\\s+NOTICE\\b', flags: 'i', key: 'after_notice' },
  { pattern: '^PART[\\s-]*HEARD\\b', flags: 'i', key: 'part_heard' },
  { pattern: '^(?:FOR\\s+)?MENTION(?:ING)?\\b', flags: 'i', key: 'mentioning' },
  { pattern: '^SUPPLEMENTARY\\b', flags: 'i', key: 'supplementary' },
  { pattern: '^ADVANCE\\b', flags: 'i', key: 'advance' },
];
