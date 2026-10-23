// Per-forum hints for the A0 adapters (#56): language profile and nomenclature. The same data is
// committed as `*.config.json` (versioned in `adapter_version`, checksum pinned by `config.test.ts`).
import { defineAdapterConfig, type AdapterConfig } from '../../config/schema.ts';
import { DISTRICT_CASE_TYPES } from '../patterns.ts';

export const GENERIC_A0_ADAPTER_ID = 'generic.a0';
export const BENGALURU_DISTRICT_ADAPTER_ID = 'in.ka.bengaluru-urban.district';
export const CHENNAI_DISTRICT_ADAPTER_ID = 'in.tn.chennai.district';
export const GENERIC_A0_VERSION = '1.0.0';

/** The catch-all forum code: a forum with no dedicated adapter resolves to `generic.a0` by id. */
export const GENERIC_A0_FORUM_CODE = 'generic.a0';

/** The district forums the catalogue seeds under each adapter id (packages/db/src/seed/forum-catalogue). */
export const BENGALURU_DISTRICT_FORUM_CODES = [
  'in.ka.bengaluru-urban.city-civil-sessions',
  'in.ka.bengaluru-urban.cmm-courts',
  'in.ka.bengaluru-urban.commercial-courts',
  'in.ka.bengaluru-urban.family-court',
  'in.ka.bengaluru-urban.industrial-tribunals',
  'in.ka.bengaluru-urban.labour-courts',
  'in.ka.bengaluru-urban.mayo-hall',
  'in.ka.bengaluru-urban.small-causes',
] as const;
export const CHENNAI_DISTRICT_FORUM_CODES = [
  'in.tn.chennai.city-civil-court',
  'in.tn.chennai.cmm-egmore',
  'in.tn.chennai.commercial-court-egmore',
  'in.tn.chennai.family-courts',
  'in.tn.chennai.small-causes',
] as const;

const STAGE_MAP = [
  { pattern: '^(?:for\\s+)?(?:appearance|filing|steps)', flags: 'i', key: 'appearance' },
  { pattern: '^(?:for\\s+)?(?:written\\s+statement|counter|reply)', flags: 'i', key: 'pleadings' },
  { pattern: '^(?:for\\s+)?(?:issues|framing\\s+of\\s+issues)', flags: 'i', key: 'issues' },
  { pattern: '^(?:for\\s+)?evidence', flags: 'i', key: 'evidence' },
  { pattern: '^(?:for\\s+)?(?:arguments|final\\s+hearing)', flags: 'i', key: 'arguments' },
  { pattern: '^(?:for\\s+)?(?:orders?|judg(?:e)?ment)', flags: 'i', key: 'orders' },
  { pattern: '^(?:for\\s+)?(?:admission|hearing)', flags: 'i', key: 'hearing' },
  // Tamil and Kannada headings (district lists print them in the local script).
  { pattern: '^ஆணை', key: 'orders' },
  { pattern: '^சாட்சிய', key: 'evidence' },
  { pattern: '^வாத', key: 'arguments' },
  { pattern: '^ಆದೇಶ', key: 'orders' },
  { pattern: '^ಸಾಕ್ಷ್ಯ', key: 'evidence' },
  { pattern: '^ವಾದ', key: 'arguments' },
];

function config(languages: string[], scripts: string[], forumId: string): AdapterConfig {
  return defineAdapterConfig({
    nomenclature: {
      caseTypes: Object.fromEntries(DISTRICT_CASE_TYPES.map((t) => [t.code, [...t.spellings]])),
      seatSuffixes: [],
    },
    // District cause-list pages carry two verification challenges and are never accessed: no deep links.
    links: {},
    languageProfile: { languages, scripts },
    fixtures: { manifest: `fixtures/${forumId}/manifest.json`, fictional: true },
    stageMap: STAGE_MAP,
    twoDigitYearPivot: 50,
  });
}

export const GENERIC_A0_CONFIG = config(['en'], ['Latn'], GENERIC_A0_ADAPTER_ID);
export const BENGALURU_DISTRICT_CONFIG = config(
  ['en', 'kn'],
  ['Latn', 'Knda'],
  BENGALURU_DISTRICT_ADAPTER_ID,
);
export const CHENNAI_DISTRICT_CONFIG = config(
  ['ta', 'en'],
  ['Taml', 'Latn'],
  CHENNAI_DISTRICT_ADAPTER_ID,
);

export const A0_CONFIGS: Readonly<Record<string, AdapterConfig>> = {
  [GENERIC_A0_ADAPTER_ID]: GENERIC_A0_CONFIG,
  [BENGALURU_DISTRICT_ADAPTER_ID]: BENGALURU_DISTRICT_CONFIG,
  [CHENNAI_DISTRICT_ADAPTER_ID]: CHENNAI_DISTRICT_CONFIG,
};
