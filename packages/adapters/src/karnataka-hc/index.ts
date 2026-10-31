// Karnataka High Court adapter, Principal Bench at Bengaluru (#404, part 1 of #37; A1). Identity,
// versioned config, declared access modes, the case-type table, the case-line grammar, advocate
// keys and official deep links; cause lists from a saved HTML list page or the layout of a list
// PDF (#405, part 2); the order header, KHC neutral citation and direction cues (#406, part 3); FR
// numbers, scrutiny objections and cure deadlines from registry notices (#407, part 4). Everything the
// adapter reads is a document the lawyer supplied; links open the court's own pages in a new window
// and nothing here requests a URL. The Dharwad and Kalaburagi Benches are disabled forums (v2).
// Every layout assumption is recorded in ADR 0019.
import { defineAdapterConfig, type AdapterConfig } from '../config/schema.ts';
import { resolveForumLink, type ForumLinkConfig } from '../madras-hc/links.ts';
import type {
  AccessModes,
  CourtAdapter,
  DeepLinkParams,
  DeepLinkTarget,
  ParsedCauseList,
  ParserInput,
} from '../types.ts';

import {
  KARNATAKA_HC_CASE_TYPE_ALIASES,
  KARNATAKA_HC_CASE_TYPES_COMPLETENESS,
} from './config/case-types.ts';
import { KARNATAKA_HC_HALL_HEADING, KARNATAKA_HC_ROW_PATTERN } from './config/list-grammar.ts';
import { KARNATAKA_HC_DIRECTION_PHRASES } from './config/order-cues.ts';
import { KARNATAKA_HC_STAGE_MAP } from './config/stage-map.ts';
import { findKarnatakaDirectionCues } from './direction-cues.ts';
import { parseKarnatakaOrderHeader } from './order-header.ts';
import { parseKarnatakaCauseListHtml } from './parse-cause-list-html.ts';
import { parseKarnatakaCauseListPdf } from './parse-cause-list-pdf.ts';
import { parseKarnatakaCauseListText } from './parse-cause-list-text.ts';

export * from './advocate-keys.ts';
export * from './case-line.ts';
export * from './config/case-types.ts';
export * from './config/column-synonyms.ts';
export * from './config/list-grammar.ts';
export * from './config/order-cues.ts';
export * from './config/stage-map.ts';
export * from './direction-cues.ts';
export { isKarnatakaListLine, karnatakaListTypeOf, karnatakaPublishedAt } from './list-reader.ts';
export * from './neutral-citation.ts';
export * from './order-header.ts';
export * from './registry-events.ts';
export { parseKarnatakaCauseListHtml } from './parse-cause-list-html.ts';
export type { KarnatakaCauseListOptions } from './parse-cause-list-html.ts';
export { parseKarnatakaCauseListPdf } from './parse-cause-list-pdf.ts';
export { parseKarnatakaCauseListText } from './parse-cause-list-text.ts';

export const KARNATAKA_HC_ADAPTER_ID = 'in.ka.karnataka-hc.bengaluru';
export const KARNATAKA_HC_VERSION = '1.1.0';
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

/**
 * A supplied list: HTML through the HTML parser, a PDF layout through the PDF parser, plain text
 * (a contributed copy, #1065) through the text parser. An HTML, PDF or text input without its
 * content cannot be read (`failed`); email lists are not read yet.
 */
export function parseKarnatakaCauseList(
  input: ParserInput,
  options: { config: AdapterConfig; version: string },
): ParsedCauseList {
  if (input.kind === 'html' && input.html !== undefined) {
    return parseKarnatakaCauseListHtml(input, options);
  }
  if (input.kind === 'text' && input.text !== undefined) {
    return parseKarnatakaCauseListText(input, options);
  }
  if (input.layout !== undefined) return parseKarnatakaCauseListPdf(input, options);
  const empty = emptyCauseList(options.version, input);
  return input.kind === 'email' ? empty : { ...empty, status: 'failed' };
}

/** A fresh Karnataka HC adapter over `options.config` (default `KARNATAKA_HC_CONFIG`, 1.1.0). */
export function createKarnatakaHcAdapter(
  options: KarnatakaHcAdapterOptions = {},
): KarnatakaHcAdapter {
  const config = options.config ?? KARNATAKA_HC_CONFIG;
  const version = options.version ?? KARNATAKA_HC_VERSION;
  const orderOptions = {
    phrases: config.orderParser.directionPhrases,
    pivot: config.twoDigitYearPivot,
    aliases: config.nomenclature.caseTypes,
  };
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
    parseCauseList: (input) => Promise.resolve(parseKarnatakaCauseList(input, { config, version })),
    parseOrderHeader: (input) => parseKarnatakaOrderHeader(input, orderOptions),
    findDirectionCues: (input) => findKarnatakaDirectionCues(input, orderOptions),
    buildDeepLink(target: DeepLinkTarget, params: DeepLinkParams) {
      const kind = config.links[target];
      if (kind === undefined || options.forumConfig === undefined) return null;
      return resolveForumLink(options.forumConfig, kind, params);
    },
  };
}
