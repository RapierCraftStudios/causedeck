// The A0 generic adapter (#56): for any forum without a dedicated adapter (Bengaluru urban and
// Chennai district courts, DRT, consumer commissions, RERA, anything the lawyer adds) it parses what
// the lawyer shared with a deterministic skeleton plus an LLM-assisted pass with mandatory anchors
// and mandatory confirmation (PRD CL-5, docs/product/10 §5.3). Ids: `generic.a0` (catch-all),
// `in.ka.bengaluru-urban.district`, `in.tn.chennai.district`. Everything an A0 adapter proposes is
// L2: shown in a confirmation grid, never applied unasked. Nothing here makes a network request;
// district cause-list pages (two verification challenges) are never accessed; the model is reached only through
// the injected gateway (see `llm-parse.ts`). The adapter object's `parseCauseList` is the
// deterministic skeleton, so the golden harness and the registry treat A0 like any adapter.
import {
  layoutFromEmail,
  layoutFromHtml,
  layoutFromText,
  matchKey,
  normaliseStage,
  type AccessModes,
  type AdapterConfig,
  type CourtAdapter,
  type LayoutDocument,
  type ParsedCauseList,
  type ParsedListRow,
  type ParsedOrderHeader,
  type ParserInput,
} from '@causedeck/adapters';

import { preParse } from '../extract/index.ts';

import {
  A0_CONFIGS,
  BENGALURU_DISTRICT_ADAPTER_ID,
  BENGALURU_DISTRICT_FORUM_CODES,
  CHENNAI_DISTRICT_ADAPTER_ID,
  CHENNAI_DISTRICT_FORUM_CODES,
  GENERIC_A0_ADAPTER_ID,
  GENERIC_A0_FORUM_CODE,
  GENERIC_A0_VERSION,
} from './config/hints.ts';
import { buildCaseTypeLookup } from './patterns.ts';
import { pagesFromLayout, skeletonPass } from './skeleton.ts';
import { validateList, type A0ParsedList } from './validate.ts';

export * from './config/hints.ts';
export * from './confirmation.ts';
export * from './corrections.ts';
export * from './llm-parse.ts';
export * from './patterns.ts';
export * from './skeleton.ts';
export * from './to-proposals.ts';
export * from './validate.ts';

/** Lists and orders only from the lawyer; there is no status or display-board access. */
export const A0_ACCESS_MODES: AccessModes = {
  cause_list: 'user_supplied',
  orders: 'user_supplied',
  status: 'none',
  display_board: 'none',
};

/** Recorded with the access-mode registry rows (migration 0062) until counsel reviews them. */
export const A0_ACCESS_NOTE =
  'A0 generic: documents the lawyer shares only; district cause-list pages (verification-challenge gated) are never accessed';

/** The forum codes each A0 adapter id serves; `generic.a0` is also the fallback for any other forum. */
export const A0_FORUM_CODES: Readonly<Record<string, readonly string[]>> = {
  [GENERIC_A0_ADAPTER_ID]: [GENERIC_A0_FORUM_CODE],
  [BENGALURU_DISTRICT_ADAPTER_ID]: BENGALURU_DISTRICT_FORUM_CODES,
  [CHENNAI_DISTRICT_ADAPTER_ID]: CHENNAI_DISTRICT_FORUM_CODES,
};

export const A0_ADAPTER_IDS = [
  GENERIC_A0_ADAPTER_ID,
  BENGALURU_DISTRICT_ADAPTER_ID,
  CHENNAI_DISTRICT_ADAPTER_ID,
] as const;

export interface A0AdapterOptions {
  id?: string;
  config?: AdapterConfig;
  version?: string;
}

const SOURCE_BY_KIND = { layout: 'pdf', html: 'html', email: 'email', text: 'text' } as const;

/** The layout a parser input is read as: a layout as given, HTML, an email or text by form feed. */
export function layoutOfInput(input: ParserInput): LayoutDocument {
  if (input.layout !== undefined) return input.layout;
  if (input.kind === 'html' && input.html !== undefined) return layoutFromHtml(input.html);
  if (input.kind === 'email' && input.text !== undefined) return layoutFromEmail(input.text);
  return layoutFromText(input.text ?? '');
}

export type A0OcrLanguage = 'en' | 'ta' | 'kn';

export interface A0OcrRouting {
  /** No page has a text layer: the document goes through OCR (#45) before it is parsed. */
  needsOcr: boolean;
  /** The forum's language profile as an OCR hint, primary language first (`ta` before `en` in Chennai). */
  languages: A0OcrLanguage[];
}

/**
 * Tamil-first and Kannada-first documents are read with the forum's language profile as the OCR
 * hint (#45); the OCR layout is then parsed like any layout. Machine translation is not performed.
 */
export function a0OcrRouting(
  profile: Pick<AdapterConfig['languageProfile'], 'languages'>,
  layout: LayoutDocument,
): A0OcrRouting {
  const languages = profile.languages.filter(
    (language): language is A0OcrLanguage =>
      language === 'en' || language === 'ta' || language === 'kn',
  );
  return {
    needsOcr: layout.pages.every((p) => p.text.trim() === '' || p.textCoverage === 0),
    languages: languages.length === 0 ? ['en'] : languages,
  };
}

/** The framework's `ParsedCauseList` for a validated A0 list. */
export function toA0ParsedCauseList(
  list: A0ParsedList,
  meta: {
    adapterId: string;
    adapterVersion: string;
    kind: ParserInput['kind'];
    layout: LayoutDocument;
  },
  config: AdapterConfig,
): ParsedCauseList {
  const rows: ParsedListRow[] = list.rows.map((row, rowIndex) => {
    const stage =
      row.stageText === undefined ? null : normaliseStage(row.stageText, config.stageMap);
    return {
      anchor: {
        page: row.anchor.page,
        quote: row.anchor.quote,
        rowIndex,
        ...(row.anchor.bbox === undefined ? {} : { bbox: row.anchor.bbox }),
      },
      confidence: row.confidence,
      ...(row.hall === undefined ? {} : { hallNo: row.hall }),
      ...(row.serial === undefined ? {} : { itemNo: row.serial }),
      caseTypeRaw: row.caseRef?.caseTypeRaw ?? '',
      caseType: row.caseRef?.caseType ?? null,
      caseNumber: row.caseRef?.caseNumber ?? null,
      caseYear: row.caseRef?.caseYear ?? null,
      matchKey: row.caseRef === undefined ? null : matchKey(row.caseRef),
      ...(row.parties === undefined ? {} : { parties: row.parties.original }),
      stageRaw: row.stageText ?? null,
      stageNorm: stage?.stageNorm ?? null,
    };
  });
  const unmappedHeadings: string[] = [];
  for (const row of rows) {
    if (
      row.stageRaw !== null &&
      row.stageNorm === null &&
      !unmappedHeadings.includes(row.stageRaw)
    ) {
      unmappedHeadings.push(row.stageRaw);
    }
  }
  const needsOcr = a0OcrRouting(config.languageProfile, meta.layout).needsOcr;
  return {
    adapterId: meta.adapterId,
    adapterVersion: meta.adapterVersion,
    forumCode: list.forumCode,
    listDate: list.listDate?.iso ?? null,
    status: needsOcr ? 'needs_ocr' : rows.length === 0 ? 'empty' : 'ok',
    rows,
    source: SOURCE_BY_KIND[meta.kind],
    ...(list.listDate === undefined
      ? {}
      : {
          listDateAnchor: {
            page: list.listDate.anchor.page,
            quote: list.listDate.anchor.quote,
            rowIndex: 0,
          },
        }),
    diagnostics: {
      unmappedHeadings,
      unknownCaseTypes: list.diagnostics.unknownCaseTypes,
      rowsSkippedNoAnchor: list.rejected.filter((r) => r.reason === 'no_anchor').length,
      hallsSeen: [...new Set(rows.flatMap((r) => (r.hallNo === undefined ? [] : [r.hallNo])))],
      hallsUnreadable: [],
    },
  };
}

/** A fresh A0 adapter (default `generic.a0`) over `options.config`, version 1.0.0. */
export function createA0Adapter(options: A0AdapterOptions = {}): CourtAdapter {
  const id = options.id ?? GENERIC_A0_ADAPTER_ID;
  const config = options.config ?? A0_CONFIGS[id];
  if (config === undefined) throw new Error(`No A0 config for adapter ${id}`);
  const version = options.version ?? GENERIC_A0_VERSION;
  const lookup = buildCaseTypeLookup();
  return {
    id,
    version,
    forumCodes: A0_FORUM_CODES[id] ?? [GENERIC_A0_FORUM_CODE],
    accessModes: A0_ACCESS_MODES,
    nomenclature: config.nomenclature,
    listing: config.listing,
    orderParser: config.orderParser,
    calendar: config.calendar,
    languageProfile: config.languageProfile,
    links: config.links,
    fixtures: config.fixtures,
    health: config.health,
    parseCauseList(input: ParserInput) {
      const layout = layoutOfInput(input);
      const pages = pagesFromLayout(layout);
      const skeleton = skeletonPass(pages, { lookup, layout, pivot: config.twoDigitYearPivot });
      const list = validateList({
        documentId: input.meta.fileName ?? 'input',
        forumCode: input.meta.forumCode,
        pages,
        skeleton,
        model: null,
        aiSkipped: 'blocked',
        layout,
        lookup,
        pivot: config.twoDigitYearPivot,
      });
      return Promise.resolve(
        toA0ParsedCauseList(
          list,
          { adapterId: id, adapterVersion: version, kind: input.kind, layout },
          config,
        ),
      );
    },
    parseOrderHeader(input: ParserInput): ParsedOrderHeader {
      const pages = pagesFromLayout(layoutOfInput(input));
      const pre = preParse(pages);
      const skeleton = skeletonPass(pages, { lookup, pivot: config.twoDigitYearPivot });
      const row = skeleton.rows[0];
      if (row === undefined) {
        return {
          caseTypeRaw: null,
          caseType: null,
          caseNumber: null,
          caseYear: null,
          orderDate: pre.orderDate?.date ?? null,
          neutralCitation: null,
          anchor: null,
          confidence: 0,
        };
      }
      return {
        caseTypeRaw: row.ref.caseTypeRaw,
        caseType: row.ref.caseType,
        caseNumber: row.ref.caseNumber,
        caseYear: row.ref.caseYear,
        orderDate: pre.orderDate?.date ?? null,
        neutralCitation: null,
        anchor: { page: row.page, quote: row.quote.trim(), rowIndex: 0 },
        confidence: row.ref.verified ? 0.5 : 0.3,
      };
    },
    findDirectionCues: () => [],
    // District pages are gated and never opened by the product: there is no deep link.
    buildDeepLink: () => null,
  };
}
