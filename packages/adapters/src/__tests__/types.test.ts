// The adapter contract (#369): zod schemas for every input and output, the frozen access-mode list
// (`official`, never `official_feed`), and the resource list.
import { ACCESS_MODES } from '@causedeck/flags/access-mode';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AccessModeSchema,
  AnchorSchema,
  CourtAdapterDescriptorSchema,
  createEchoAdapter,
  DeepLinkSchema,
  ParsedListRowSchema,
  ParserInputSchema,
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
