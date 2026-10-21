// The echo adapter (#369): a minimal court adapter for a made-up forum that proves the framework
// end to end (config, normalisers, anchors, diagnostics, determinism). Its list format is plain
// text, one page per form feed:
//
//   CAUSE LIST FOR 21.10.2026        -> list date
//   COURT HALL 1                     -> hall heading (`listing.hallHeading`)
//   FOR ADMISSION                    -> stage heading (`stageMap`; unknown ones are kept verbatim)
//   1. W.P. No. 12345 of 2026  A vs B -> a row (`listing.rowPattern`)
//
// Lines before the first hall heading are preamble. Every emitted row quotes its line verbatim
// from the page text; a row whose quote cannot be found there is dropped and counted. Parsing is
// pure: no clock, no randomness, no I/O. Rows are returned to the caller, never stored.
import { defineAdapterConfig, type AdapterConfig } from '../config/schema.ts';
import { parseCaseReference } from '../normalise/case-number.ts';
import { compactCaseType } from '../normalise/case-type.ts';
import { normaliseDate } from '../normalise/date.ts';
import { matchKey } from '../normalise/match-key.ts';
import { normaliseNeutralCitation } from '../normalise/neutral-citation.ts';
import { normaliseStage } from '../normalise/stage.ts';
import type {
  AccessModes,
  Anchor,
  CourtAdapter,
  DeepLink,
  DeepLinkParams,
  DirectionCue,
  ParsedCauseList,
  ParsedListRow,
  ParsedOrderHeader,
  ParserInput,
  Resource,
} from '../types.ts';

export const ECHO_ADAPTER_ID = 'echo';
export const ECHO_FORUM_CODE = 'test.echo.principal';
export const ECHO_VERSION = '1.0.0';

export const ECHO_CONFIG: AdapterConfig = defineAdapterConfig({
  nomenclature: {
    caseTypes: { WP: ['Writ Petition'], WA: [], CRLOP: [], ARBOP: [], CMA: [] },
    seatSuffixes: ['MD'],
  },
  listing: {
    hallHeading: '^COURT\\s+HALL\\s+(?:NO\\.?\\s*)?([0-9A-Z]+)$',
    rowPattern: '^(\\d+)\\.\\s+(.+)$',
  },
  orderParser: { directionPhrases: ['list after', 'post after', 'is directed to', 'call on'] },
  links: { cause_list: 'cause_list', orders: 'orders' },
  fixtures: { manifest: 'fixtures/manifest.json', fictional: true },
  stageMap: [
    { pattern: '^FOR\\s+ADMISSION$', flags: 'i', key: 'admission' },
    { pattern: '^FOR\\s+ORDERS$', flags: 'i', key: 'orders' },
    { pattern: '^FOR\\s+FINAL\\s+HEARING$', flags: 'i', key: 'final_hearing' },
    { pattern: '^MENTION', flags: 'i', key: 'mention' },
  ],
  twoDigitYearPivot: 50,
});

const ECHO_ACCESS_MODES: AccessModes = {
  cause_list: 'user_supplied',
  orders: 'user_supplied',
  status: 'none',
  display_board: 'none',
};

export interface EchoAdapterOptions {
  /** Resolves a deep-link kind for the echo forum; without it `buildDeepLink` returns null. */
  resolveDeepLink?: (kind: string, params: DeepLinkParams) => DeepLink | null;
}

interface Page {
  page: number;
  text: string;
  items: { text: string; bbox: { x: number; y: number; width: number; height: number } }[];
}

/** The pages of an input: layout pages as given, text split on form feeds. */
function pagesOf(input: ParserInput): Page[] {
  if (input.layout !== undefined) {
    return input.layout.pages.map(({ page, text, items }) => ({ page, text, items }));
  }
  const text = input.text ?? '';
  if (text === '') return [];
  return text
    .split('\f')
    .map((pageText, index) => ({ page: index + 1, text: pageText, items: [] }));
}

/** An anchor for `quote` on `page`, or null when the quote is not verbatim in the page text. */
function anchorFor(page: Page, quote: string, rowIndex: number): Anchor | null {
  if (quote === '' || !page.text.includes(quote)) return null;
  const item = page.items.find((candidate) => candidate.text.trim() === quote);
  return item === undefined
    ? { page: page.page, quote, rowIndex }
    : { page: page.page, quote, rowIndex, bbox: item.bbox };
}

const round = (value: number) => Math.round(value * 100) / 100;
const PARTIES_AFTER_NUMBER = /\d{1,7}\s*(?:\/|\bof\b|-)\s*(?:\d{4}|\d{2})\b\s*(.*)$/i;

function parseCauseListSync(config: AdapterConfig, input: ParserInput): ParsedCauseList {
  const hallHeading = new RegExp(config.listing.hallHeading ?? '(?!)', 'i');
  const rowPattern = new RegExp(config.listing.rowPattern ?? '(?!)');
  const knownTypes = new Set(Object.keys(config.nomenclature.caseTypes).map(compactCaseType));
  const yearOptions = { pivot: config.twoDigitYearPivot };
  const caseTypeOptions = {
    aliases: config.nomenclature.caseTypes,
    seatSuffixes: config.nomenclature.seatSuffixes,
  };

  const rows: ParsedListRow[] = [];
  const unmappedHeadings: string[] = [];
  const unknownCaseTypes: string[] = [];
  const hallsSeen: string[] = [];
  const rowsPerHall = new Map<string, number>();
  let rowsSkippedNoAnchor = 0;
  let listDate: string | null = null;
  let hallNo: string | undefined;
  let stage: { stageRaw: string | null; stageNorm: string | null } = {
    stageRaw: null,
    stageNorm: null,
  };

  for (const page of pagesOf(input)) {
    for (const rawLine of page.text.split('\n')) {
      const line = rawLine.trim();
      if (line === '') continue;
      if (listDate === null && /^CAUSE\s+LIST\b/i.test(line)) {
        listDate = normaliseDate(line, yearOptions);
        continue;
      }
      const hall = hallHeading.exec(line);
      if (hall !== null) {
        hallNo = hall[1] ?? line;
        if (!hallsSeen.includes(hallNo)) hallsSeen.push(hallNo);
        rowsPerHall.set(hallNo, rowsPerHall.get(hallNo) ?? 0);
        stage = { stageRaw: null, stageNorm: null };
        continue;
      }
      if (hallNo === undefined) continue;
      const row = rowPattern.exec(line);
      if (row === null) {
        stage = normaliseStage(line, config.stageMap);
        if (stage.stageNorm === null && !unmappedHeadings.includes(line)) {
          unmappedHeadings.push(line);
        }
        continue;
      }
      const anchor = anchorFor(page, line, rows.length);
      if (anchor === null) {
        rowsSkippedNoAnchor += 1;
        continue;
      }
      const rest = row[2] ?? '';
      const reference = parseCaseReference(rest, { ...yearOptions, ...caseTypeOptions });
      let confidence = reference === null ? 0.3 : 1;
      if (
        reference !== null &&
        (reference.caseType === null || !knownTypes.has(reference.caseType))
      ) {
        confidence -= 0.3;
        if (!unknownCaseTypes.includes(reference.caseTypeRaw)) {
          unknownCaseTypes.push(reference.caseTypeRaw);
        }
      }
      if (stage.stageNorm === null) confidence -= 0.1;
      const parties = PARTIES_AFTER_NUMBER.exec(rest)?.[1]?.trim();
      const caseType = reference?.caseType ?? null;
      const caseNumber = reference?.number ?? null;
      const caseYear = reference?.year ?? null;
      rows.push({
        anchor,
        confidence: round(Math.max(0, confidence)),
        hallNo,
        itemNo: row[1] ?? '',
        caseTypeRaw: reference?.caseTypeRaw ?? '',
        caseType,
        ...(reference?.seatSuffix === undefined ? {} : { seatSuffix: reference.seatSuffix }),
        caseNumber,
        caseYear,
        matchKey: matchKey({ caseType, seatSuffix: reference?.seatSuffix, caseNumber, caseYear }),
        ...(parties === undefined || parties === '' ? {} : { parties }),
        stageRaw: stage.stageRaw,
        stageNorm: stage.stageNorm,
      });
      rowsPerHall.set(hallNo, (rowsPerHall.get(hallNo) ?? 0) + 1);
    }
  }

  return {
    adapterId: ECHO_ADAPTER_ID,
    adapterVersion: ECHO_VERSION,
    forumCode: input.meta.forumCode,
    listDate,
    rows,
    diagnostics: {
      unmappedHeadings,
      unknownCaseTypes,
      rowsSkippedNoAnchor,
      hallsSeen,
      hallsUnreadable: hallsSeen.filter((hall) => rowsPerHall.get(hall) === 0),
    },
  };
}

function parseOrderHeader(config: AdapterConfig, input: ParserInput): ParsedOrderHeader {
  const options = {
    pivot: config.twoDigitYearPivot,
    aliases: config.nomenclature.caseTypes,
    seatSuffixes: config.nomenclature.seatSuffixes,
  };
  let reference: ReturnType<typeof parseCaseReference> = null;
  let anchor: Anchor | null = null;
  let orderDate: string | null = null;
  let neutralCitation: string | null = null;
  for (const page of pagesOf(input)) {
    for (const rawLine of page.text.split('\n')) {
      const line = rawLine.trim();
      if (line === '') continue;
      if (reference === null) {
        reference = parseCaseReference(line, options);
        if (reference !== null) anchor = anchorFor(page, line, 0);
      }
      if (orderDate === null && /^(?:order\s+)?dated?\b/i.test(line)) {
        orderDate = normaliseDate(line, { pivot: config.twoDigitYearPivot });
      }
      neutralCitation ??= normaliseNeutralCitation(line);
    }
  }
  const found = [reference !== null, orderDate !== null].filter(Boolean).length;
  return {
    caseTypeRaw: reference?.caseTypeRaw ?? null,
    caseType: reference?.caseType ?? null,
    ...(reference?.seatSuffix === undefined ? {} : { seatSuffix: reference.seatSuffix }),
    caseNumber: reference?.number ?? null,
    caseYear: reference?.year ?? null,
    orderDate,
    neutralCitation,
    anchor,
    confidence: found / 2,
  };
}

function findDirectionCues(config: AdapterConfig, input: ParserInput): DirectionCue[] {
  const phrases = config.orderParser.directionPhrases.map((p) => p.toLowerCase());
  const cues: DirectionCue[] = [];
  for (const page of pagesOf(input)) {
    for (const sentence of page.text.split(/\n|(?<=[.?!])\s+/)) {
      const text = sentence.trim();
      if (text === '' || !phrases.some((phrase) => text.toLowerCase().includes(phrase))) continue;
      const anchor = anchorFor(page, text, cues.length);
      if (anchor !== null) cues.push({ kind: 'direction', text, anchor, confidence: 0.6 });
    }
  }
  return cues;
}

/** A fresh echo adapter over `ECHO_CONFIG`. */
export function createEchoAdapter(options: EchoAdapterOptions = {}): CourtAdapter {
  const config = ECHO_CONFIG;
  return {
    id: ECHO_ADAPTER_ID,
    version: ECHO_VERSION,
    forumCodes: [ECHO_FORUM_CODE],
    accessModes: ECHO_ACCESS_MODES,
    nomenclature: config.nomenclature,
    listing: config.listing,
    orderParser: config.orderParser,
    calendar: config.calendar,
    languageProfile: config.languageProfile,
    links: config.links,
    fixtures: config.fixtures,
    health: config.health,
    parseCauseList: (input) => Promise.resolve(parseCauseListSync(config, input)),
    parseOrderHeader: (input) => parseOrderHeader(config, input),
    findDirectionCues: (input) => findDirectionCues(config, input),
    buildDeepLink(resource: Resource, params: DeepLinkParams) {
      const kind = config.links[resource];
      if (kind === undefined || options.resolveDeepLink === undefined) return null;
      return options.resolveDeepLink(kind, params);
    },
  };
}
