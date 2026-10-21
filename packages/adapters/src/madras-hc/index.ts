// Madras High Court adapter, Principal Seat (#395, part 1 of #36; A1). Identity, versioned config,
// declared access modes, the case-type table, the case-line grammar, advocate keys and official deep
// links (#395), the cause-list and AIMS email parsers (#396). The order-header and direction-cue
// parsers land in part 3 (#398): until then they return well-formed empty results. Everything the adapter reads is a
// document the lawyer supplied; links open the court's own pages in a new window and nothing here
// requests a URL. The Madurai Bench is a separate, disabled forum with its own adapter config later.
import type { AdapterConfig } from '../config/schema.ts';
import type {
  AccessModes,
  CourtAdapter,
  DeepLinkParams,
  DeepLinkTarget,
  ParsedOrderHeader,
} from '../types.ts';

import {
  MADRAS_HC_ADAPTER_ID,
  MADRAS_HC_CONFIG,
  MADRAS_HC_FORUM_CODES,
  MADRAS_HC_VERSION,
} from './config/adapter-config.ts';
import { MADRAS_HC_CASE_TYPES_COMPLETENESS } from './config/case-types.ts';
import { resolveForumLink, type ForumLinkConfig } from './links.ts';
import { parseAimsEmail } from './parse-aims-email.ts';
import { parseMadrasCauseList } from './parse-cause-list.ts';

export * from './advocates.ts';
export * from './case-line.ts';
export * from './config/adapter-config.ts';
export * from './config/case-types.ts';
export * from './config/email-profiles.ts';
export * from './config/list-grammar.ts';
export * from './config/order-cues.ts';
export * from './config/stage-map.ts';
export * from './links.ts';
export { parseAimsEmail, type ParseAimsEmailOptions } from './parse-aims-email.ts';
export {
  listPagesOf,
  parseListLines,
  parseMadrasCauseList,
  repairCaseText,
  type ListLinesOptions,
  type ListPage,
  type MadrasCauseListOptions,
} from './parse-cause-list.ts';

/** Lists and orders only from the lawyer; case status and the display board are never read. */
export const MADRAS_HC_ACCESS_MODES: AccessModes = {
  cause_list: 'user_supplied',
  orders: 'user_supplied',
  status: 'none',
  display_board: 'none',
};

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
    parseCauseList: (input) =>
      Promise.resolve(
        input.kind === 'email'
          ? parseAimsEmail(input.text ?? '', { forumCode: input.meta.forumCode, version, config })
          : parseMadrasCauseList(input, { config, version }),
      ),
    parseOrderHeader: () => ({ ...EMPTY_ORDER_HEADER, caseRefs: [] }),
    findDirectionCues: () => [],
    buildDeepLink(target: DeepLinkTarget, params: DeepLinkParams) {
      const kind = config.links[target];
      if (kind === undefined || options.forumConfig === undefined) return null;
      return resolveForumLink(options.forumConfig, kind, params);
    },
  };
}
