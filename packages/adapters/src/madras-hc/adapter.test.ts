// The Madras HC adapter skeleton (#395): identity, registration, access modes, config, deep links,
// a well-formed empty cause list until part 2 (#396), and the order parsers wired in (#398).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FORUM_CATALOGUE } from '@causedeck/db/seed/forum-catalogue';
import { describe, expect, it } from 'vitest';

import { ADAPTER_FACTORIES } from '../config/activate.ts';
import { BUNDLED_ADAPTER_CONFIGS } from '../config/loader.ts';
import { AdapterConfigSchema } from '../config/schema.ts';
import * as entry from '../index.ts';
import { createAdapterRegistry } from '../registry.ts';
import {
  DeepLinkSchema,
  DirectionCueSchema,
  ParsedCauseListSchema,
  ParsedOrderHeaderSchema,
  type ParserInput,
} from '../types.ts';

import {
  createMadrasHcAdapter,
  MADRAS_HC_ADAPTER_ID,
  MADRAS_HC_BUNDLED,
  MADRAS_HC_CONFIG,
  MADRAS_HC_FORUM_CODES,
  resolveForumLink,
} from './index.ts';

const principal = FORUM_CATALOGUE.find(
  (forum) => forum.code === 'in.tn.madras-hc.principal.appellate',
);
if (principal === undefined) throw new Error('Madras HC Principal Seat forum missing from seed');

const input: ParserInput = {
  kind: 'text',
  text: 'CAUSE LIST\nCOURT No. 1\n1. W.P.No.1 of 2026 FICTIONAL vs FICTIONAL',
  meta: { receivedAt: '2026-10-21T00:00:00Z', forumCode: 'in.tn.madras-hc.principal.appellate' },
};

describe('Madras HC adapter (#395)', () => {
  it('serves the Principal Seat forums of the catalogue under the dotted id', () => {
    const adapter = createMadrasHcAdapter();
    expect(adapter.id).toBe('in.tn.madras-hc.principal');
    expect(adapter.version).toBe('1.0.0');
    expect(adapter.caseTypeCompleteness).toBe('partial');
    expect(adapter.forumCodes).toEqual([...MADRAS_HC_FORUM_CODES]);
    for (const code of adapter.forumCodes) {
      expect(FORUM_CATALOGUE.find((forum) => forum.code === code)?.adapterId).toBe(adapter.id);
    }
    const registry = createAdapterRegistry();
    registry.register(adapter);
    expect(registry.resolveByForum('in.tn.madras-hc.principal.original')).toBe(adapter);
    expect(registry.resolveByForum('in.tn.madras-hc.madurai')).toBeUndefined();
  });

  it('is registered with the loader, the activation factories and the package entry', () => {
    expect(BUNDLED_ADAPTER_CONFIGS[MADRAS_HC_ADAPTER_ID]).toBe(MADRAS_HC_BUNDLED);
    const factory = ADAPTER_FACTORIES[MADRAS_HC_ADAPTER_ID];
    expect(factory?.(MADRAS_HC_BUNDLED).id).toBe(MADRAS_HC_ADAPTER_ID);
    expect(entry.createMadrasHcAdapter).toBe(createMadrasHcAdapter);
    expect(entry.parseCaseLine).toBeTypeOf('function');
  });

  it('declares user-supplied lists and orders only', () => {
    expect(createMadrasHcAdapter().accessModes).toEqual({
      cause_list: 'user_supplied',
      orders: 'user_supplied',
      status: 'none',
      display_board: 'none',
    });
  });

  it('ships adapter.config.json equal to the built config', () => {
    const json: unknown = JSON.parse(
      readFileSync(path.join(import.meta.dirname, 'config/adapter.config.json'), 'utf8'),
    );
    expect(AdapterConfigSchema.parse(json)).toEqual(MADRAS_HC_CONFIG);
    expect(MADRAS_HC_CONFIG.fixtures.fictional).toBe(true);
  });

  it('opens cause list, case status, JUDIS, e-copy and AIMS in a new window from the forum config', () => {
    const adapter = createMadrasHcAdapter({ forumConfig: principal.config });
    const links = (['cause_list', 'status', 'orders', 'e_copy', 'aims'] as const).map((target) =>
      adapter.buildDeepLink(target, {}),
    );
    for (const link of links) {
      expect(DeepLinkSchema.safeParse(link).success).toBe(true);
      expect(link).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
    }
    const [causeList, status, judis, eCopy, aims] = links;
    expect(causeList?.url).toBe(`https://${principal.config.hosts[0] ?? ''}/cause_list_mhc.php`);
    expect(causeList?.fallbacks).toHaveLength(principal.config.hosts.length - 1);
    expect(status?.url).toMatch(/\/case_status_mas\.php$/);
    expect(judis?.url).toMatch(/\/judis\/$/);
    expect(eCopy?.url).toMatch(/\/eservices\/copyapp\/$/);
    expect(aims?.url).toMatch(/\/aims\/$/);
    expect(adapter.buildDeepLink('display_board', {})).toBeNull();
    expect(createMadrasHcAdapter().buildDeepLink('cause_list', {})).toBeNull();
  });

  it('fills template parameters, URL-encoded, and refuses a missing one or a non-https link', () => {
    const config = {
      hosts: ['one.example.test', 'two.example.test'],
      deepLinks: { case_status: 'status?no={number}', orders: 'http://one.example.test/x' },
    };
    expect(resolveForumLink(config, 'case_status', { number: '1/2026' })).toEqual({
      url: 'https://one.example.test/status?no=1%2F2026',
      fallbacks: ['https://two.example.test/status?no=1%2F2026'],
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(resolveForumLink(config, 'case_status', {})).toBeNull();
    expect(resolveForumLink(config, 'orders', {})).toBeNull();
    expect(resolveForumLink(config, 'aims', {})).toBeNull();
  });

  it('returns a well-formed empty cause list until the list parser lands', async () => {
    const adapter = createMadrasHcAdapter();
    const list = await adapter.parseCauseList(input);
    expect(ParsedCauseListSchema.parse(list)).toMatchObject({
      adapterId: MADRAS_HC_ADAPTER_ID,
      forumCode: input.meta.forumCode,
      status: 'empty',
      source: 'text',
      rows: [],
      halls: [],
      unparsedRows: [],
    });
  });

  it('parses order headers and direction cues (#398)', () => {
    const adapter = createMadrasHcAdapter();
    const order: ParserInput = {
      ...input,
      text: 'DATED: 21.10.2026\nTHE HONOURABLE MR.JUSTICE A. FICTIONAL\nW.P.No.1 of 2026\nORDER\nPost on 12.11.2026.',
    };
    expect(ParsedOrderHeaderSchema.parse(adapter.parseOrderHeader(order))).toMatchObject({
      caseType: 'WP',
      caseNumber: '1',
      orderDate: '2026-10-21',
      orderType: 'daily',
    });
    expect(
      adapter.findDirectionCues(order).map((cue) => DirectionCueSchema.parse(cue)),
    ).toMatchObject([{ kind: 'next_date', date: '2026-11-12' }]);
    // The configured phrases drive the cues.
    const quiet = createMadrasHcAdapter({
      config: { ...MADRAS_HC_CONFIG, orderParser: { directionPhrases: ['list after'] } },
    });
    expect(quiet.findDirectionCues(order)).toEqual([]);
  });
});
