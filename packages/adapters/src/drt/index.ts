// The DRT and DRAT adapter, `in.drt` (#662, part 2 of #498): cause lists from the tribunals' saved
// HTML pages, for every Debts Recovery Tribunal and Appellate Tribunal forum in the catalogue. The
// terms of use of drt.gov.in have not been read, so every resource is `user_supplied` or `none`:
// the adapter parses what the lawyer shares and never retrieves anything. Orders stay with the A0
// generic adapter until there are fixtures. Status pages are read by `parseDrtStatus`.
import { defineAdapterConfig, type AdapterConfig } from '../config/schema.ts';
import type {
  AccessModes,
  CourtAdapter,
  DeepLink,
  DeepLinkParams,
  ParserInput,
  Resource,
} from '../types.ts';

import { parseDrtCauseList } from './cause-list.ts';

export * from './cause-list.ts';

export const DRT_ADAPTER_ID = 'in.drt';
export const DRT_VERSION = '1.0.0';

/** Recorded with the access-mode registry rows until counsel reviews them. */
export const DRT_ACCESS_NOTE = 'DRT T&C not yet read, counsel review pending (#118)';

const DRT_CITIES = [
  'bengaluru-1',
  'bengaluru-2',
  'delhi-1',
  'delhi-2',
  'delhi-3',
  'mumbai-1',
  'mumbai-2',
  'mumbai-3',
  'chennai-1',
  'chennai-2',
  'chennai-3',
  'kolkata-1',
  'kolkata-2',
  'hyderabad',
  'ahmedabad',
  'pune',
  'chandigarh-1',
  'jaipur',
  'lucknow',
  'ernakulam',
  'coimbatore',
] as const;
const DRAT_CITIES = ['mumbai', 'delhi', 'kolkata', 'chennai', 'allahabad'] as const;

/** Every DRT and DRAT forum the adapter serves (the catalogue lists the same codes). */
export const DRT_FORUM_CODES: readonly string[] = [
  ...DRT_CITIES.map((city) => `in.drt.${city}`),
  ...DRAT_CITIES.map((city) => `in.drat.${city}`),
];

export const DRT_ACCESS_MODES: AccessModes = {
  cause_list: 'user_supplied',
  orders: 'none',
  status: 'none',
  display_board: 'none',
};

export const DRT_CONFIG: AdapterConfig = defineAdapterConfig({
  nomenclature: {
    caseTypes: {
      OA: ['OA'],
      SA: ['SA'],
      TA: ['TA'],
      RC: ['RC'],
      IA: ['IA'],
      MA: ['MA'],
      RP: ['RP'],
    },
    seatSuffixes: [],
  },
  links: { cause_list: 'cause_list' },
  fixtures: { manifest: 'fixtures/in.drt/manifest.json', fictional: true },
  stageMap: [
    { pattern: '^admission', flags: 'i', key: 'admission' },
    { pattern: '^(?:final\\s+)?hearing', flags: 'i', key: 'hearing' },
    { pattern: '^(?:for\\s+)?orders?$', flags: 'i', key: 'orders' },
    { pattern: '^(?:reply|written statement|counter)', flags: 'i', key: 'pleadings' },
    { pattern: '^(?:evidence|arguments)', flags: 'i', key: 'evidence' },
  ],
  twoDigitYearPivot: 50,
});

/** The config the adapter ships with: the loader's fallback when no version is active (#372). */
export const DRT_BUNDLED: { version: string; config: AdapterConfig } = {
  version: DRT_VERSION,
  config: DRT_CONFIG,
};

export interface DrtAdapterOptions {
  /** A versioned config (#372, `adapter_version`); defaults to `DRT_CONFIG`. */
  config?: AdapterConfig;
  version?: string;
  /** Resolves a deep-link kind for the forum; without it `buildDeepLink` returns null. */
  resolveDeepLink?: (kind: string, params: DeepLinkParams) => DeepLink | null;
}

/** A fresh DRT/DRAT adapter over `options.config` (default `DRT_CONFIG`, version 1.0.0). */
export function createDrtAdapter(options: DrtAdapterOptions = {}): CourtAdapter {
  const config = options.config ?? DRT_CONFIG;
  const version = options.version ?? DRT_VERSION;
  return {
    id: DRT_ADAPTER_ID,
    version,
    forumCodes: DRT_FORUM_CODES,
    accessModes: DRT_ACCESS_MODES,
    nomenclature: config.nomenclature,
    listing: config.listing,
    orderParser: config.orderParser,
    calendar: config.calendar,
    languageProfile: config.languageProfile,
    links: config.links,
    fixtures: config.fixtures,
    health: config.health,
    parseCauseList(input: ParserInput) {
      // The pages are HTML tables; anything else has to be saved as a page first.
      return Promise.resolve(
        parseDrtCauseList(input.html ?? '', {
          adapterId: DRT_ADAPTER_ID,
          adapterVersion: version,
          forumCode: input.meta.forumCode,
          stageMap: config.stageMap,
        }),
      );
    },
    parseOrderHeader: () => ({
      caseTypeRaw: null,
      caseType: null,
      caseNumber: null,
      caseYear: null,
      orderDate: null,
      neutralCitation: null,
      anchor: null,
      confidence: 0,
    }),
    findDirectionCues: () => [],
    buildDeepLink(resource: Resource, params: DeepLinkParams) {
      const kind = config.links[resource];
      if (kind === undefined || options.resolveDeepLink === undefined) return null;
      return options.resolveDeepLink(kind, params);
    },
  };
}
