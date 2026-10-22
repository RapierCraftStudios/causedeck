// The adapter contract (#369): zod schemas for every input and output, the frozen access-mode list
// (`official`, never `official_feed`), and the resource list.
import { ACCESS_MODES } from '@causedeck/flags/access-mode';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AccessModeSchema,
  AnchorSchema,
  CaseRefSchema,
  CourtAdapterDescriptorSchema,
  createEchoAdapter,
  DEEP_LINK_TARGETS,
  DeepLinkSchema,
  DirectionCueSchema,
  ParsedCauseListSchema,
  ParsedListRowSchema,
  PARSE_STATUSES,
  ParsedOrderHeaderSchema,
  ParserInputSchema,
  RegistryEventSchema,
  RESOURCES,
  type AccessMode,
  type CourtAdapter,
  type DeepLink,
  type DirectionCue,
  type ParsedCauseList,
  type ParsedOrderHeader,
  type ParserInput,
  type Resource,
} from '../index.ts';

describe('adapter contract', () => {
  it('reuses the frozen access-mode list', () => {
    expect(AccessModeSchema.options).toEqual([...ACCESS_MODES]);
    expect(AccessModeSchema.safeParse('official_feed').success).toBe(false);
    expectTypeOf<AccessMode>().toEqualTypeOf<
      'user_supplied' | 'device_user_triggered' | 'official' | 'licensed' | 'none'
    >();
  });

  it('declares a mode for each of the four resources', () => {
    expect([...RESOURCES]).toEqual(['cause_list', 'orders', 'status', 'display_board']);
    expectTypeOf<Resource>().toEqualTypeOf<'cause_list' | 'orders' | 'status' | 'display_board'>();
    const adapter = createEchoAdapter();
    expect(
      CourtAdapterDescriptorSchema.parse({
        id: adapter.id,
        version: adapter.version,
        forumCodes: [...adapter.forumCodes],
        accessModes: adapter.accessModes,
      }).accessModes,
    ).toEqual({
      cause_list: 'user_supplied',
      orders: 'user_supplied',
      status: 'none',
      display_board: 'none',
    });
    expect(
      CourtAdapterDescriptorSchema.safeParse({
        id: 'x',
        version: '1.0.0',
        forumCodes: ['x.y'],
        accessModes: { ...adapter.accessModes, status: 'official_feed' },
      }).success,
    ).toBe(false);
  });

  it('exposes the adapter fields and typed methods', () => {
    expect(Object.keys(createEchoAdapter())).toEqual(
      expect.arrayContaining([
        'id',
        'version',
        'forumCodes',
        'accessModes',
        'nomenclature',
        'listing',
        'orderParser',
        'calendar',
        'languageProfile',
        'links',
        'fixtures',
        'health',
        'parseCauseList',
        'parseOrderHeader',
        'findDirectionCues',
        'buildDeepLink',
      ]),
    );
    expectTypeOf<CourtAdapter['parseCauseList']>().toEqualTypeOf<
      (input: ParserInput) => Promise<ParsedCauseList>
    >();
    expectTypeOf<CourtAdapter['parseOrderHeader']>().returns.toEqualTypeOf<ParsedOrderHeader>();
    expectTypeOf<CourtAdapter['findDirectionCues']>().returns.toEqualTypeOf<DirectionCue[]>();
    expectTypeOf<CourtAdapter['buildDeepLink']>().returns.toEqualTypeOf<DeepLink | null>();
  });

  it('rejects a row without an anchor and an anchor without a quote', () => {
    const row = {
      confidence: 1,
      caseTypeRaw: 'W.P.',
      caseType: 'WP',
      caseNumber: '1',
      caseYear: 2026,
      matchKey: 'WP/1/2026',
      stageRaw: null,
      stageNorm: null,
    };
    expect(ParsedListRowSchema.safeParse(row).success).toBe(false);
    expect(
      ParsedListRowSchema.safeParse({ ...row, anchor: { page: 1, quote: 'x', rowIndex: 0 } })
        .success,
    ).toBe(true);
    expect(AnchorSchema.safeParse({ page: 1, quote: '', rowIndex: 0 }).success).toBe(false);
    expect(AnchorSchema.safeParse({ page: 0, quote: 'x', rowIndex: 0 }).success).toBe(false);
  });

  it('keeps the #35 shapes valid and accepts the optional #36 additions (#395)', () => {
    const anchor = { page: 1, quote: 'x', rowIndex: 0 };
    const ref = {
      caseTypeCode: 'CRLOP',
      caseTypeRaw: 'CRL OP',
      number: '4567',
      year: 2026,
      matchKey: 'CRLOP/4567/2026',
      children: [
        {
          caseTypeCode: 'CRLMP',
          caseTypeRaw: 'Crl.M.P.',
          number: '1',
          year: 2026,
          isMisc: true,
          matchKey: 'CRLMP/1/2026',
          parentProceedingKey: 'CRLOP/4567/2026',
        },
      ],
    };
    const row = {
      anchor,
      confidence: 1,
      caseTypeRaw: 'CRL OP',
      caseType: 'CRLOP',
      caseNumber: '4567',
      caseYear: 2026,
      matchKey: 'CRLOP/4567/2026',
      stageRaw: null,
      stageNorm: null,
    };
    expect(ParsedListRowSchema.safeParse(row).success).toBe(true);
    expect(
      ParsedListRowSchema.safeParse({
        ...row,
        advocates: [{ raw: 'R. FICTIONAL', aliases: ['R FICTIONAL'], enrolmentNo: 'MS/1/2000' }],
        children: ref.children,
        parentProceedingKey: null,
        bench: 'FICTIONAL J',
        forumMismatch: true,
      }).success,
    ).toBe(true);
    const diagnostics = {
      unmappedHeadings: [],
      unknownCaseTypes: [],
      rowsSkippedNoAnchor: 0,
      hallsSeen: [],
      hallsUnreadable: [],
    };
    const list = {
      adapterId: 'echo',
      adapterVersion: '1.0.0',
      forumCode: 'a.b',
      listDate: null,
      rows: [row],
      diagnostics,
    };
    expect(ParsedCauseListSchema.safeParse(list).success).toBe(true);
    expect(
      ParsedCauseListSchema.safeParse({
        ...list,
        halls: [{ hallNo: '1', bench: 'FICTIONAL J', lists: [{ rows: [row] }] }],
        unparsedRows: [{ anchor, text: 'x', reason: 'no_case_number' }],
        status: 'empty',
        listType: 'supplementary',
        source: 'email',
      }).success,
    ).toBe(true);
    expect(ParsedCauseListSchema.safeParse({ ...list, status: 'partial' }).success).toBe(false);
    const header = {
      caseTypeRaw: null,
      caseType: null,
      caseNumber: null,
      caseYear: null,
      orderDate: null,
      neutralCitation: null,
      anchor: null,
      confidence: 0,
    };
    expect(ParsedOrderHeaderSchema.safeParse(header).success).toBe(true);
    expect(
      ParsedOrderHeaderSchema.safeParse({
        ...header,
        caseRefs: [ref],
        bench: 'X',
        orderType: 'interim',
      }).success,
    ).toBe(true);
    const cue = { kind: 'direction', text: 'post on 12.11.2026', anchor, confidence: 0.6 };
    expect(DirectionCueSchema.safeParse(cue).success).toBe(true);
    expect(
      DirectionCueSchema.safeParse({ ...cue, phrase: 'post on', date: '2026-11-12' }).success,
    ).toBe(true);
    expect(
      RegistryEventSchema.safeParse({
        kind: 'cure_deadline',
        anchor,
        confidence: 0.8,
        srNo: '12345',
        caseRef: ref,
        deadline: { n: 7, unit: 'days', basisDate: '2026-10-21', derived: '2026-10-28' },
      }).success,
    ).toBe(true);
    expect(RegistryEventSchema.safeParse({ kind: 'listed', anchor, confidence: 1 }).success).toBe(
      false,
    );
    // Karnataka FR numbers and scrutiny objections (#407).
    expect(
      RegistryEventSchema.safeParse({
        kind: 'fr_assigned',
        anchor,
        confidence: 0.95,
        frNo: '1234/2026',
      }).success,
    ).toBe(true);
    expect(
      RegistryEventSchema.safeParse({ kind: 'objection_raised', anchor, confidence: 0.8 }).success,
    ).toBe(true);
    expect(
      RegistryEventSchema.safeParse({ kind: 'fr_assigned', anchor, confidence: 0.95, frNo: '' })
        .success,
    ).toBe(false);
    expect([...DEEP_LINK_TARGETS]).toEqual([...RESOURCES, 'e_copy', 'aims']);
  });

  it('accepts the optional #37 additions and keeps them optional (#404)', () => {
    const anchor = { page: 1, quote: 'x', rowIndex: 0 };
    const row = {
      anchor,
      confidence: 1,
      caseTypeRaw: 'W.P.',
      caseType: 'WP',
      caseNumber: '100150',
      caseYear: 2024,
      matchKey: 'WP/100150/2024',
      stageRaw: null,
      stageNorm: null,
      advocates: [],
      listNo: '2',
      listType: 'supplementary',
      registryObjection: 'OFFICE OBJECTIONS',
      subCategory: 'GM-RES',
      benchNumbering: '100xxx',
    };
    expect(ParsedListRowSchema.safeParse(row).success).toBe(true);
    expect(ParsedListRowSchema.safeParse({ ...row, benchNumbering: '200xxx' }).success).toBe(false);
    expect(ParsedListRowSchema.safeParse({ ...row, subCategory: '' }).success).toBe(false);
    // A row under the registry-objections heading carries `true` (#405); a marker stays a string.
    expect(ParsedListRowSchema.safeParse({ ...row, registryObjection: true }).success).toBe(true);
    expect(ParsedListRowSchema.safeParse({ ...row, registryObjection: null }).success).toBe(true);
    expect(ParsedListRowSchema.safeParse({ ...row, registryObjection: false }).success).toBe(false);
    expect(ParsedListRowSchema.safeParse({ ...row, registryObjection: '' }).success).toBe(false);
    expect(
      CaseRefSchema.safeParse({
        caseTypeCode: 'WP',
        caseTypeRaw: 'WP',
        number: '100150',
        year: 2024,
        matchKey: 'WP/100150/2024',
        subCategory: 'GM-RES',
        benchNumbering: '100xxx',
      }).success,
    ).toBe(true);
    const list = {
      adapterId: 'in.ka.karnataka-hc.bengaluru',
      adapterVersion: '1.0.0',
      forumCode: 'in.ka.karnataka-hc.bengaluru',
      listDate: null,
      rows: [row],
      diagnostics: {
        unmappedHeadings: [],
        unknownCaseTypes: [],
        rowsSkippedNoAnchor: 0,
        hallsSeen: [],
        hallsUnreadable: [],
      },
    };
    expect([...PARSE_STATUSES]).toEqual(['ok', 'empty', 'not_a_cause_list', 'failed', 'needs_ocr']);
    for (const status of PARSE_STATUSES) {
      expect(ParsedCauseListSchema.safeParse({ ...list, status }).success, status).toBe(true);
    }
    expect(
      ParsedCauseListSchema.safeParse({ ...list, publishedAt: '2026-10-21T18:00:00+05:30' })
        .success,
    ).toBe(true);
    const header = {
      caseTypeRaw: null,
      caseType: null,
      caseNumber: null,
      caseYear: null,
      orderDate: null,
      neutralCitation: null,
      anchor: null,
      confidence: 0,
    };
    expect(ParsedOrderHeaderSchema.safeParse({ ...header, authenticityFlag: null }).success).toBe(
      true,
    );
    expect(ParsedOrderHeaderSchema.safeParse({ ...header, authenticityFlag: true }).success).toBe(
      false,
    );
    expect(ParsedOrderHeaderSchema.safeParse(header).success).toBe(true);
  });

  it('validates parser inputs and new-window https deep links', () => {
    expect(
      ParserInputSchema.safeParse({ kind: 'pdf', meta: { receivedAt: 'x', forumCode: 'a.b' } })
        .success,
    ).toBe(false);
    const link = {
      url: 'https://example.test/x',
      fallbacks: [],
      target: '_blank',
      rel: 'noopener noreferrer',
    };
    expect(DeepLinkSchema.safeParse(link).success).toBe(true);
    expect(DeepLinkSchema.safeParse({ ...link, url: 'http://example.test/x' }).success).toBe(false);
    expect(DeepLinkSchema.safeParse({ ...link, target: '_self' }).success).toBe(false);
  });
});
