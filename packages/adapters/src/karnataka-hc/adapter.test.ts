// The Karnataka HC adapter skeleton (#404): identity, registration, access modes, the reserved
// display-board legend slot, config, deep links; the list parsers (#405) wired into parseCauseList,
// and the order header and direction cues wired in part 3 (#406).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FORUM_CATALOGUE } from '@causedeck/db/seed/forum-catalogue';
import { describe, expect, it } from 'vitest';

import { ADAPTER_FACTORIES } from '../config/activate.ts';
import { BUNDLED_ADAPTER_CONFIGS } from '../config/loader.ts';
import { AdapterConfigSchema } from '../config/schema.ts';
import { ECHO_CONFIG } from '../example/echo-adapter.ts';
import * as entry from '../index.ts';
import { MADRAS_HC_CONFIG } from '../madras-hc/index.ts';
import { createAdapterRegistry } from '../registry.ts';
import {
  CourtAdapterDescriptorSchema,
  DeepLinkSchema,
  ParsedCauseListSchema,
  ParsedOrderHeaderSchema,
  type ParserInput,
} from '../types.ts';

import {
  createKarnatakaHcAdapter,
  KARNATAKA_HC_ADAPTER_ID,
  KARNATAKA_HC_BUNDLED,
  KARNATAKA_HC_CONFIG,
} from './index.ts';

const bengaluru = FORUM_CATALOGUE.find((forum) => forum.code === 'in.ka.karnataka-hc.bengaluru');
if (bengaluru === undefined) throw new Error('Karnataka HC Principal Bench missing from seed');

const input: ParserInput = {
  kind: 'layout',
  meta: { receivedAt: '2026-10-22T00:00:00Z', forumCode: 'in.ka.karnataka-hc.bengaluru' },
};

describe('Karnataka HC adapter (#404)', () => {
  it('registers under the dotted id the catalogue binds', () => {
    const adapter = createKarnatakaHcAdapter();
    expect(adapter.id).toBe('in.ka.karnataka-hc.bengaluru');
    expect(adapter.version).toBe('1.1.0');
    expect(adapter.caseTypeCompleteness).toBe('partial');
    expect(CourtAdapterDescriptorSchema.safeParse(adapter).success).toBe(true);
    expect(bengaluru.adapterId).toBe(adapter.id);
    const registry = createAdapterRegistry();
    registry.register(adapter);
    expect(registry.resolveById(KARNATAKA_HC_ADAPTER_ID)).toBe(adapter);
    expect(registry.resolveByForum('in.ka.karnataka-hc.bengaluru')).toBe(adapter);
    expect(registry.resolveByForum('in.ka.karnataka-hc.dharwad')).toBeUndefined();
  });

  it('is registered with the loader, the activation factories and the package entry', () => {
    expect(BUNDLED_ADAPTER_CONFIGS[KARNATAKA_HC_ADAPTER_ID]).toBe(KARNATAKA_HC_BUNDLED);
    expect(ADAPTER_FACTORIES[KARNATAKA_HC_ADAPTER_ID]?.(KARNATAKA_HC_BUNDLED).id).toBe(
      KARNATAKA_HC_ADAPTER_ID,
    );
    expect(entry.createKarnatakaHcAdapter).toBe(createKarnatakaHcAdapter);
    expect(entry.parseKarnatakaCaseLine).toBeTypeOf('function');
    // The Madras exports are still there, unshadowed.
    expect(entry.parseCaseLine).toBeTypeOf('function');
  });

  it('declares user-supplied lists and orders only and reserves the display-board legend', () => {
    expect(createKarnatakaHcAdapter().accessModes).toEqual({
      cause_list: 'user_supplied',
      orders: 'user_supplied',
      status: 'none',
      display_board: 'none',
    });
    expect(KARNATAKA_HC_CONFIG.stageCodeLegend).toEqual({});
    // The slot is optional: the echo and Madras configs carry none.
    expect(ECHO_CONFIG.stageCodeLegend).toBeUndefined();
    expect(MADRAS_HC_CONFIG.stageCodeLegend).toBeUndefined();
  });

  it('ships adapter.config.json equal to the built config', () => {
    const json: unknown = JSON.parse(
      readFileSync(path.join(import.meta.dirname, 'config/adapter.config.json'), 'utf8'),
    );
    expect(AdapterConfigSchema.parse(json)).toEqual(KARNATAKA_HC_CONFIG);
    expect(KARNATAKA_HC_CONFIG.fixtures.fictional).toBe(true);
  });

  it('opens the cause list, case status and judgments in a new window from the forum config', () => {
    const adapter = createKarnatakaHcAdapter({ forumConfig: bengaluru.config });
    const host = bengaluru.config.hosts[0] ?? '';
    const expected = {
      cause_list: `https://${host}/causelistp.php`,
      status: `https://${host}/casemenu.php`,
      orders: `https://${host}/rep_judgment.php`,
    } as const;
    for (const [target, url] of Object.entries(expected)) {
      const link = adapter.buildDeepLink(target as keyof typeof expected, {});
      expect(DeepLinkSchema.safeParse(link).success).toBe(true);
      expect(link).toMatchObject({ url, target: '_blank', rel: 'noopener noreferrer' });
    }
    // The display board is `none`: no link, and nothing without the forum config.
    expect(adapter.buildDeepLink('display_board', {})).toBeNull();
    expect(createKarnatakaHcAdapter().buildDeepLink('cause_list', {})).toBeNull();
  });

  it('reads HTML and PDF lists, and fails a list input without its content (#405)', async () => {
    const adapter = createKarnatakaHcAdapter();
    expect(adapter.version).toBe('1.1.0');
    const list = await adapter.parseCauseList(input);
    expect(ParsedCauseListSchema.parse(list)).toMatchObject({
      adapterId: KARNATAKA_HC_ADAPTER_ID,
      adapterVersion: '1.1.0',
      forumCode: input.meta.forumCode,
      status: 'failed',
      source: 'pdf',
      publishedAt: null,
      listType: null,
      rows: [],
    });
    const html = await adapter.parseCauseList({
      kind: 'html',
      html:
        '<div>COURT HALL NO. 1</div><table><tr><th>Sl. No.</th><th>Case No.</th></tr>' +
        '<tr><td>1</td><td><a href="#">WP No. 1/2026</a></td></tr></table>',
      meta: input.meta,
    });
    expect(html).toMatchObject({ status: 'ok', source: 'html' });
    expect(html.rows.map((row) => row.matchKey)).toEqual(['WP/1/2026']);
    // Text and email lists are not read yet: a well-formed empty result.
    const text = await adapter.parseCauseList({ kind: 'text', text: 'x', meta: input.meta });
    expect(text).toMatchObject({ status: 'empty', source: 'text', rows: [] });
  });

  it('reads nothing from an empty order, with the authenticity flag reserved as null', () => {
    const adapter = createKarnatakaHcAdapter();
    expect(ParsedOrderHeaderSchema.parse(adapter.parseOrderHeader(input))).toMatchObject({
      authenticityFlag: null,
      caseRefs: [],
      confidence: 0,
    });
    expect(adapter.findDirectionCues(input)).toEqual([]);
  });

  it('parses a supplied order header and its direction cues (#406)', () => {
    const adapter = createKarnatakaHcAdapter();
    const order: ParserInput = {
      kind: 'text',
      text: [
        'IN THE HIGH COURT OF KARNATAKA AT BENGALURU',
        'DATED THIS THE 14TH DAY OF NOVEMBER, 2026',
        'BEFORE',
        "THE HON'BLE MR JUSTICE A. FICTIONAL",
        'W.P. No. 12345 of 2026 (GM-RES)',
        '2026:KHC:1234',
        'ORDER',
        'The impugned order dated 03.03.2019 is under challenge.',
        'Respondents to file statement of objections within four weeks. List after two weeks.',
      ].join('\n'),
      meta: input.meta,
    };
    expect(ParsedOrderHeaderSchema.parse(adapter.parseOrderHeader(order))).toMatchObject({
      caseType: 'WP',
      caseNumber: '12345',
      caseYear: 2026,
      orderDate: '2026-11-14',
      neutralCitation: '2026:KHC:1234',
      authenticityFlag: null,
    });
    expect(adapter.findDirectionCues(order).map((cue) => [cue.kind, cue.date])).toEqual([
      ['time_bound', null],
      ['next_date_relative', null],
    ]);
  });

  it('reads no URL: no source file of the adapter names fetch or a network module', () => {
    const files = [
      'index.ts',
      'case-line.ts',
      'advocate-keys.ts',
      'order-header.ts',
      'neutral-citation.ts',
      'direction-cues.ts',
      'config/case-types.ts',
      'config/stage-map.ts',
      'config/list-grammar.ts',
      'config/column-synonyms.ts',
      'config/order-cues.ts',
      'list-reader.ts',
      'parse-cause-list-html.ts',
      'parse-cause-list-pdf.ts',
    ];
    for (const file of files) {
      const source = readFileSync(path.join(import.meta.dirname, file), 'utf8');
      expect(source, file).not.toMatch(/\bfetch\s*\(|node:(?:http|https|net)|XMLHttpRequest/);
    }
  });
});
