// The committed Madras HC order and registry-notice fixtures (#398): 12 orders and 5 registry
// notices, all synthetic and FICTIONAL, listed in manifest.json, parse to their expected files with
// every anchor quote verbatim on its page. Cause-list and AIMS email fixtures come with #396.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FIXTURES_ROOT, FixtureManifestSchema, GOLDEN_RECEIVED_AT } from '../testing/golden.ts';
import {
  DirectionCueSchema,
  ParsedOrderHeaderSchema,
  RegistryEventSchema,
  type Anchor,
  type ParserInput,
} from '../types.ts';

import { createMadrasHcAdapter, MADRAS_HC_ADAPTER_ID, parseRegistryEvents } from './index.ts';

const dir = path.join(FIXTURES_ROOT, MADRAS_HC_ADAPTER_ID);
const manifest = FixtureManifestSchema.parse(
  JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
);
const adapter = createMadrasHcAdapter();
const orders = manifest.fixtures.filter((entry) => entry.kind === 'order');
const notices = manifest.fixtures.filter((entry) => entry.kind === 'registry_notice');

function inputOf(file: string): ParserInput {
  return {
    kind: 'text',
    text: readFileSync(path.join(dir, file), 'utf8'),
    meta: {
      fileName: file,
      receivedAt: GOLDEN_RECEIVED_AT,
      forumCode: adapter.forumCodes[0] ?? '',
    },
  };
}

const expectedOf = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(dir, file.replace(/\.input\.txt$/, '.expected.json')), 'utf8'));

function expectVerbatim(input: ParserInput, anchors: readonly Anchor[], file: string) {
  const pages = (input.text ?? '').split('\f');
  for (const anchor of anchors) {
    const lines = (pages[anchor.page - 1] ?? '').split('\n');
    expect(lines[anchor.rowIndex], `${file}: ${anchor.quote}`).toContain(anchor.quote);
  }
}

describe('Madras HC order and registry fixtures', () => {
  it('commits 12 orders and 5 registry notices, synthetic and FICTIONAL', () => {
    expect(manifest.adapter).toBe(MADRAS_HC_ADAPTER_ID);
    expect(manifest.classification).toBe('FICTIONAL');
    expect(orders).toHaveLength(12);
    expect(notices).toHaveLength(5);
    for (const entry of [...orders, ...notices]) {
      expect(entry, entry.file).toMatchObject({ origin: 'synthetic', classification: 'FICTIONAL' });
      expect(readFileSync(path.join(dir, entry.file), 'utf8'), entry.file).toContain('FICTIONAL');
    }
  });

  it.each(orders.map((entry) => entry.file))(
    '%s parses to its expected header and cues',
    (file) => {
      const input = inputOf(file);
      const header = ParsedOrderHeaderSchema.parse(adapter.parseOrderHeader(input));
      const cues = adapter.findDirectionCues(input).map((cue) => DirectionCueSchema.parse(cue));
      expect({ header, cues }).toEqual(expectedOf(file));
      expectVerbatim(
        input,
        [...(header.anchor === null ? [] : [header.anchor]), ...cues.map((cue) => cue.anchor)],
        file,
      );
    },
  );

  it.each(notices.map((entry) => entry.file))('%s parses to its expected events', (file) => {
    const input = inputOf(file);
    const events = parseRegistryEvents(input).map((event) => RegistryEventSchema.parse(event));
    expect({ events }).toEqual(expectedOf(file));
    expect(events.length, file).toBeGreaterThan(0);
    expectVerbatim(
      input,
      events.map((event) => event.anchor),
      file,
    );
  });

  it('never takes the decoy earlier-order date as the order date or a next date', () => {
    const input = inputOf('order-08-decoy-earlier-order-date.input.txt');
    expect(input.text).toContain('order dated 03.03.2019');
    expect(adapter.parseOrderHeader(input).orderDate).toBe('2026-10-21');
    const cues = adapter.findDirectionCues(input);
    expect(cues.map((cue) => cue.kind)).toEqual(['next_date']);
    expect(cues.every((cue) => cue.date === null)).toBe(true);
  });

  it('reads the next date on page 22 of the long order', () => {
    const input = inputOf('order-11-long-over-20-pages.input.txt');
    expect((input.text ?? '').split('\f').length).toBeGreaterThan(20);
    const cue = adapter.findDirectionCues(input).find((c) => c.kind === 'next_date');
    expect(cue?.date).toBe('2026-12-03');
    expect(cue?.anchor.page).toBe(22);
  });
});
