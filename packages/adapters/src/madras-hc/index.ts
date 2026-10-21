// Madras High Court adapter, Principal Seat (#395, part 1 of #36; A1). Identity, versioned config,
// declared access modes, the case-type table, the case-line grammar, advocate keys and official deep
// links. The list, AIMS email, order-header and direction-cue parsers land in parts 2 and 3 (#396,
// #398): until then they return well-formed empty results. Everything the adapter reads is a
// document the lawyer supplied; links open the court's own pages in a new window and nothing here
// requests a URL. The Madurai Bench is a separate, disabled forum with its own adapter config later.
import { defineAdapterConfig, type AdapterConfig } from '../config/schema.ts';
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
  MADRAS_HC_CASE_TYPE_ALIASES,
  MADRAS_HC_CASE_TYPES_COMPLETENESS,
} from './config/case-types.ts';
import { HALL_HEADING, ROW_PATTERN } from './config/list-grammar.ts';
import { DIRECTION_PHRASES } from './config/order-cues.ts';
import { MADRAS_HC_STAGE_MAP } from './config/stage-map.ts';
import { resolveForumLink, type ForumLinkConfig } from './links.ts';

export * from './advocates.ts';
export * from './case-line.ts';
export * from './config/case-types.ts';
export * from './config/email-profiles.ts';
export * from './config/list-grammar.ts';
export * from './config/order-cues.ts';
export * from './config/stage-map.ts';
export * from './links.ts';

export const MADRAS_HC_ADAPTER_ID = 'in.tn.madras-hc.principal';
export const MADRAS_HC_VERSION = '1.0.0';
export const MADRAS_HC_FORUM_CODES = [
  'in.tn.madras-hc.principal.original',
  'in.tn.madras-hc.principal.appellate',
] as const;

/** Lists and orders only from the lawyer; case status and the display board are never read. */
export const MADRAS_HC_ACCESS_MODES: AccessModes = {
  cause_list: 'user_supplied',
  orders: 'user_supplied',
  status: 'none',
  display_board: 'none',
};

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

/** The loader's fallback when no `adapter_version` row is active (#372). */
export const MADRAS_HC_BUNDLED: { version: string; config: AdapterConfig } = {
  version: MADRAS_HC_VERSION,
  config: MADRAS_HC_CONFIG,
};

export interface MadrasHcAdapterOptions {
  /** A versioned config (#372, `adapter_version`); defaults to `MADRAS_HC_CONFIG`. */
  config?: AdapterConfig;
  version?: string;
  /** The forum's catalogue config; without it `buildDeepLink` returns null. */
  forumConfig?: ForumLinkConfig;
}

export interface MadrasHcAdapter extends CourtAdapter {
  /** The case-type table is incomplete until the full dropdown is captured (#119). */
  readonly caseTypeCompleteness: typeof MADRAS_HC_CASE_TYPES_COMPLETENESS;
}

const SOURCE_BY_KIND = {
  layout: 'pdf',
  html: 'html',
  text: 'text',
  email: 'email',
} as const satisfies Record<ParserInput['kind'], NonNullable<ParsedCauseList['source']>>;

function emptyCauseList(version: string, input: ParserInput): ParsedCauseList {
  return {
    adapterId: MADRAS_HC_ADAPTER_ID,
    adapterVersion: version,
    forumCode: input.meta.forumCode,
    listDate: null,
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

const EMPTY_ORDER_HEADER: ParsedOrderHeader = {
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
};

/** A fresh Madras HC adapter over `options.config` (default `MADRAS_HC_CONFIG`, version 1.0.0). */
export function createMadrasHcAdapter(options: MadrasHcAdapterOptions = {}): MadrasHcAdapter {
  const config = options.config ?? MADRAS_HC_CONFIG;
  const version = options.version ?? MADRAS_HC_VERSION;
  return {
    id: MADRAS_HC_ADAPTER_ID,
    version,
    forumCodes: [...MADRAS_HC_FORUM_CODES],
    accessModes: MADRAS_HC_ACCESS_MODES,
    caseTypeCompleteness: MADRAS_HC_CASE_TYPES_COMPLETENESS,
    nomenclature: config.nomenclature,
    listing: config.listing,
    orderParser: config.orderParser,
    calendar: config.calendar,
    languageProfile: config.languageProfile,
    links: config.links,
    fixtures: config.fixtures,
    health: config.health,
    parseCauseList: (input) => Promise.resolve(emptyCauseList(version, input)),
    parseOrderHeader: () => ({ ...EMPTY_ORDER_HEADER, caseRefs: [] }),
    findDirectionCues: () => [],
    buildDeepLink(target: DeepLinkTarget, params: DeepLinkParams) {
      const kind = config.links[target];
      if (kind === undefined || options.forumConfig === undefined) return null;
      return resolveForumLink(options.forumConfig, kind, params);
    },
  };
}
