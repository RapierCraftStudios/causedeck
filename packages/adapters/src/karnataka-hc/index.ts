// Karnataka High Court adapter, Principal Bench at Bengaluru (#404, part 1 of #37; A1). Identity,
// versioned config, declared access modes, the case-type table, the case-line grammar, advocate
// keys and official deep links. The list, order-header, direction-cue and registry parsers land in
// parts 2 to 4 (#405-#407): until then they return well-formed empty results. Everything the
// adapter reads is a document the lawyer supplied; links open the court's own pages in a new window
// and nothing here requests a URL. The Dharwad and Kalaburagi Benches are disabled forums (v2).
// Every layout assumption is recorded in ADR 0018.
import { defineAdapterConfig, type AdapterConfig } from '../config/schema.ts';
import { resolveForumLink, type ForumLinkConfig } from '../madras-hc/links.ts';
import type {
  AccessModes,
  CourtAdapter,
  DeepLinkParams,
  DeepLinkTarget,
  ParsedCauseList,
  ParsedOrderHeader,
  ParserInput,
} from '../types.ts';

import {
  KARNATAKA_HC_CASE_TYPE_ALIASES,
  KARNATAKA_HC_CASE_TYPES_COMPLETENESS,
} from './config/case-types.ts';
import { KARNATAKA_HC_HALL_HEADING, KARNATAKA_HC_ROW_PATTERN } from './config/list-grammar.ts';
import { KARNATAKA_HC_DIRECTION_PHRASES } from './config/order-cues.ts';
import { KARNATAKA_HC_STAGE_MAP } from './config/stage-map.ts';

export * from './advocate-keys.ts';
export * from './case-line.ts';
export * from './config/case-types.ts';
export * from './config/column-synonyms.ts';
export * from './config/list-grammar.ts';
export * from './config/order-cues.ts';
export * from './config/stage-map.ts';

export const KARNATAKA_HC_ADAPTER_ID = 'in.ka.karnataka-hc.bengaluru';
export const KARNATAKA_HC_VERSION = '1.0.0';
export const KARNATAKA_HC_FORUM_CODES = ['in.ka.karnataka-hc.bengaluru'] as const;

/** Lists and orders only from the lawyer; case status and the display board are never read. */
export const KARNATAKA_HC_ACCESS_MODES: AccessModes = {
  cause_list: 'user_supplied',
  orders: 'user_supplied',
  status: 'none',
  display_board: 'none',
};

/** Deep-link target -> forum deep-link kind (ADR 0014). */
export const KARNATAKA_HC_LINKS: Record<string, string> = {
  cause_list: 'cause_list',
  status: 'case_status',
  orders: 'orders',
};

/**
 * The config the adapter ships with; `adapter.config.json` holds the same value (checked in tests).
 * `stageCodeLegend` is an empty slot reserved for the legally gated display-board work.
 */
export const KARNATAKA_HC_CONFIG: AdapterConfig = defineAdapterConfig({
  nomenclature: { caseTypes: { ...KARNATAKA_HC_CASE_TYPE_ALIASES }, seatSuffixes: [] },
  listing: { hallHeading: KARNATAKA_HC_HALL_HEADING, rowPattern: KARNATAKA_HC_ROW_PATTERN },
  orderParser: { directionPhrases: KARNATAKA_HC_DIRECTION_PHRASES },
  links: KARNATAKA_HC_LINKS,
  fixtures: { manifest: `fixtures/${KARNATAKA_HC_ADAPTER_ID}/manifest.json`, fictional: true },
  stageMap: KARNATAKA_HC_STAGE_MAP,
  twoDigitYearPivot: 50,
  stageCodeLegend: {},
});

/** The loader's fallback when no `adapter_version` row is active (#372). */
export const KARNATAKA_HC_BUNDLED: { version: string; config: AdapterConfig } = {
  version: KARNATAKA_HC_VERSION,
  config: KARNATAKA_HC_CONFIG,
};

export interface KarnatakaHcAdapterOptions {
  /** A versioned config (#372, `adapter_version`); defaults to `KARNATAKA_HC_CONFIG`. */
  config?: AdapterConfig;
  version?: string;
  /** The forum's catalogue config; without it `buildDeepLink` returns null. */
  forumConfig?: ForumLinkConfig;
}

export interface KarnatakaHcAdapter extends CourtAdapter {
  /** The case-type table is incomplete until `casetypes.pdf` is captured (#119). */
  readonly caseTypeCompleteness: typeof KARNATAKA_HC_CASE_TYPES_COMPLETENESS;
}

const SOURCE_BY_KIND = {
  layout: 'pdf',
  html: 'html',
  text: 'text',
  email: 'email',
} as const satisfies Record<ParserInput['kind'], NonNullable<ParsedCauseList['source']>>;

function emptyCauseList(version: string, input: ParserInput): ParsedCauseList {
  return {
    adapterId: KARNATAKA_HC_ADAPTER_ID,
    adapterVersion: version,
    forumCode: input.meta.forumCode,
    listDate: null,
    publishedAt: null,
    listType: null,
    source: SOURCE_BY_KIND[input.kind],
    status: 'empty',
    halls: [],
    rows: [],
    unparsedRows: [],
    diagnostics: {
      unmappedHeadings: [],
      unknownCaseTypes: [],
      rowsSkippedNoAnchor: 0,
      hallsSeen: [],
      hallsUnreadable: [],
    },
  };
}

function emptyOrderHeader(): ParsedOrderHeader {
  return {
    caseTypeRaw: null,
    caseType: null,
    caseNumber: null,
    caseYear: null,
    orderDate: null,
    neutralCitation: null,
    anchor: null,
    confidence: 0,
    caseRefs: [],
    bench: null,
    orderType: null,
    authenticityFlag: null,
  };
}

/** A fresh Karnataka HC adapter over `options.config` (default `KARNATAKA_HC_CONFIG`, 1.0.0). */
export function createKarnatakaHcAdapter(
  options: KarnatakaHcAdapterOptions = {},
): KarnatakaHcAdapter {
  const config = options.config ?? KARNATAKA_HC_CONFIG;
  const version = options.version ?? KARNATAKA_HC_VERSION;
  return {
    id: KARNATAKA_HC_ADAPTER_ID,
    version,
    forumCodes: [...KARNATAKA_HC_FORUM_CODES],
    accessModes: KARNATAKA_HC_ACCESS_MODES,
    caseTypeCompleteness: KARNATAKA_HC_CASE_TYPES_COMPLETENESS,
    nomenclature: config.nomenclature,
    listing: config.listing,
    orderParser: config.orderParser,
    calendar: config.calendar,
    languageProfile: config.languageProfile,
    links: config.links,
    fixtures: config.fixtures,
    health: config.health,
    parseCauseList: (input) => Promise.resolve(emptyCauseList(version, input)),
    parseOrderHeader: () => emptyOrderHeader(),
    findDirectionCues: () => [],
    buildDeepLink(target: DeepLinkTarget, params: DeepLinkParams) {
      const kind = config.links[target];
      if (kind === undefined || options.forumConfig === undefined) return null;
      return resolveForumLink(options.forumConfig, kind, params);
    },
  };
}
