// The NCLT Bengaluru adapter, `in.nclt.bengaluru` (#38, ADR 0018): cause lists from the bench's
// table-format PDFs, read as a `LayoutDocument` (`layoutFromPdf`, or an OCR layout from #45). NCLT's
// terms of use have not been read, so every resource is `user_supplied` or `none`: the adapter
// parses what the lawyer shares and never retrieves anything. NCLT orders stay with the A0 generic
// adapter (#56) until there are fixtures, so `parseOrderHeader` finds nothing here.
import { defineAdapterConfig, type AdapterConfig } from '../config/schema.ts';
import { matchKey } from '../normalise/match-key.ts';
import { normaliseStage } from '../normalise/stage.ts';
import type {
  AccessModes,
  CourtAdapter,
  DeepLink,
  DeepLinkParams,
  ParsedCauseList,
  ParsedListRow,
  ParserInput,
  Resource,
} from '../types.ts';

import { NCLT_COLUMNS } from './config/columns.ts';
import { NCLT_PREFIXES } from './config/prefixes.ts';
import { parseNcltCauseList, type NcltCauseList } from './parse-cause-list.ts';

export * from './case-number.ts';
export * from './config/columns.ts';
export * from './config/prefixes.ts';
export * from './parse-cause-list.ts';

export const NCLT_ADAPTER_ID = 'in.nclt.bengaluru';
export const NCLT_FORUM_CODE = 'in.nclt.bengaluru';
export const NCLT_VERSION = '1.0.0';

/** Recorded with the access-mode registry rows (migration 0047) until counsel reviews them. */
export const NCLT_ACCESS_NOTE = 'NCLT T&C not yet read, counsel review pending (#118)';

export const NCLT_ACCESS_MODES: AccessModes = {
  cause_list: 'user_supplied',
  orders: 'user_supplied',
  status: 'none',
  display_board: 'none',
};

export const NCLT_CONFIG: AdapterConfig = defineAdapterConfig({
  nomenclature: {
    caseTypes: Object.fromEntries(NCLT_PREFIXES.map(({ code, prefix }) => [code, [prefix]])),
    seatSuffixes: ['BB'],
  },
  links: { cause_list: 'cause_list' },
  fixtures: { manifest: 'fixtures/in.nclt.bengaluru/manifest.json', fictional: true },
  table: {
    columns: Object.fromEntries(
      Object.entries(NCLT_COLUMNS).map(([key, spellings]) => [key, [...spellings]]),
    ),
    minHeaderMatches: 5,
    columnTolerancePx: 6,
  },
  stageMap: [
    { pattern: '^admission', flags: 'i', key: 'admission' },
    { pattern: '^pronouncement', flags: 'i', key: 'pronouncement' },
    { pattern: '^(?:for\\s+)?orders?$', flags: 'i', key: 'orders' },
    { pattern: '^(?:final\\s+)?hearing$', flags: 'i', key: 'hearing' },
    { pattern: '^compliance', flags: 'i', key: 'compliance' },
    { pattern: '^(?:reply|counter|rejoinder)', flags: 'i', key: 'pleadings' },
  ],
  twoDigitYearPivot: 50,
});

/** The config the adapter ships with: the loader's fallback when no version is active (#372). */
export const NCLT_BUNDLED: { version: string; config: AdapterConfig } = {
  version: NCLT_VERSION,
  config: NCLT_CONFIG,
};

export interface NcltAdapterOptions {
  /** A versioned config (#372, `adapter_version`); defaults to `NCLT_CONFIG`. */
  config?: AdapterConfig;
  version?: string;
  /** Resolves a deep-link kind for the forum; without it `buildDeepLink` returns null. */
  resolveDeepLink?: (kind: string, params: DeepLinkParams) => DeepLink | null;
}

/** The framework's row for an NCLT row: the matter number, parties, purpose and advocates. */
function toListRow(
  row: NcltCauseList['rows'][number],
  config: AdapterConfig,
  known: ReadonlySet<string>,
): ParsedListRow {
  const stage = normaliseStage(row.purpose ?? '', config.stageMap);
  const caseType = row.cp.code;
  const seatSuffix = row.cp.bench ?? undefined;
  return {
    anchor: row.anchor,
    confidence: known.has(caseType) ? 1 : 0.7,
    hallNo: String(row.benchIndex + 1),
    ...(row.slNo === null ? {} : { itemNo: row.slNo }),
    caseTypeRaw: row.cp.prefix,
    caseType,
    ...(seatSuffix === undefined ? {} : { seatSuffix }),
    caseNumber: row.cp.number,
    caseYear: row.cp.year,
    matchKey: matchKey({
      caseType,
      seatSuffix,
      caseNumber: row.cp.number,
      caseYear: row.cp.year,
    }),
    ...(row.parties === null ? {} : { parties: row.parties }),
    stageRaw: row.purpose,
    stageNorm: row.purpose === null ? null : stage.stageNorm,
    advocates: row.advocates,
  };
}

/** The framework's `ParsedCauseList` for a parsed NCLT list. */
export function toParsedCauseList(
  parsed: NcltCauseList,
  meta: { adapterVersion: string; forumCode: string },
  config: AdapterConfig,
): ParsedCauseList {
  const known = new Set(Object.keys(config.nomenclature.caseTypes));
  const rows = parsed.rows.map((row) => toListRow(row, config, known));
  const unmappedHeadings: string[] = [];
  for (const row of rows) {
    if (row.stageRaw !== null && row.stageNorm === null && !unmappedHeadings.includes(row.stageRaw))
      unmappedHeadings.push(row.stageRaw);
  }
  const hallsSeen = parsed.benches.map((_, index) => String(index + 1));
  return {
    adapterId: NCLT_ADAPTER_ID,
    adapterVersion: meta.adapterVersion,
    forumCode: meta.forumCode,
    listDate: parsed.listDate,
    status: parsed.status === 'needs_ocr' ? 'needs_ocr' : rows.length === 0 ? 'empty' : 'ok',
    rows,
    unparsedRows: parsed.unparsedRows.flatMap(({ anchor, reason }) =>
      anchor === null ? [] : [{ anchor, text: anchor.quote, reason }],
    ),
    diagnostics: {
      unmappedHeadings,
      unknownCaseTypes: [...parsed.diagnostics.unknownPrefixes],
      rowsSkippedNoAnchor: parsed.unparsedRows.length,
      hallsSeen: parsed.status === 'needs_ocr' ? [] : hallsSeen,
      hallsUnreadable:
        parsed.status === 'needs_ocr'
          ? []
          : hallsSeen.filter((hall) => !rows.some((row) => row.hallNo === hall)),
    },
  };
}

/** A fresh NCLT Bengaluru adapter over `options.config` (default `NCLT_CONFIG`, version 1.0.0). */
export function createNcltAdapter(options: NcltAdapterOptions = {}): CourtAdapter {
  const config = options.config ?? NCLT_CONFIG;
  const version = options.version ?? NCLT_VERSION;
  return {
    id: NCLT_ADAPTER_ID,
    version,
    forumCodes: [NCLT_FORUM_CODE],
    accessModes: NCLT_ACCESS_MODES,
    nomenclature: config.nomenclature,
    listing: config.listing,
    orderParser: config.orderParser,
    calendar: config.calendar,
    languageProfile: config.languageProfile,
    links: config.links,
    fixtures: config.fixtures,
    health: config.health,
    parseCauseList(input: ParserInput) {
      // Only a layout carries the coordinates a table needs; anything else has to be read first.
      const parsed = parseNcltCauseList(input.layout ?? { pages: [] }, config);
      return Promise.resolve(
        toParsedCauseList(
          parsed,
          { adapterVersion: version, forumCode: input.meta.forumCode },
          config,
        ),
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
