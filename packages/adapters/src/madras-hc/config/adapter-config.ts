// Madras HC adapter identity and bundled config (#395; moved out of `index.ts` in #396 so the list
// and AIMS email parsers can default to it without an import cycle).
import { defineAdapterConfig, type AdapterConfig } from '../../config/schema.ts';

import { MADRAS_HC_CASE_TYPE_ALIASES } from './case-types.ts';
import { HALL_HEADING, ROW_PATTERN } from './list-grammar.ts';
import { DIRECTION_PHRASES } from './order-cues.ts';
import { MADRAS_HC_STAGE_MAP } from './stage-map.ts';

export const MADRAS_HC_ADAPTER_ID = 'in.tn.madras-hc.principal';
export const MADRAS_HC_VERSION = '1.0.0';
export const MADRAS_HC_FORUM_CODES = [
  'in.tn.madras-hc.principal.original',
  'in.tn.madras-hc.principal.appellate',
] as const;

/** Deep-link target -> forum deep-link kind (ADR 0014); `orders` opens JUDIS. */
export const MADRAS_HC_LINKS: Record<string, string> = {
  cause_list: 'cause_list',
  status: 'case_status',
  orders: 'orders',
  e_copy: 'e_copy',
  aims: 'aims',
};

/** The config the adapter ships with; `adapter.config.json` holds the same value (checked in tests). */
export const MADRAS_HC_CONFIG: AdapterConfig = defineAdapterConfig({
  nomenclature: {
    caseTypes: { ...MADRAS_HC_CASE_TYPE_ALIASES },
    seatSuffixes: ['MD'],
  },
  listing: { hallHeading: HALL_HEADING, rowPattern: ROW_PATTERN },
  orderParser: { directionPhrases: DIRECTION_PHRASES },
  links: MADRAS_HC_LINKS,
  fixtures: { manifest: `fixtures/${MADRAS_HC_ADAPTER_ID}/manifest.json`, fictional: true },
  stageMap: MADRAS_HC_STAGE_MAP,
  twoDigitYearPivot: 50,
});
