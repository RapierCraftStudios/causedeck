// Statutes (#1124): section keys that match the corpus and issue tags, the version in force on a
// date, and counterparts read from `CODE_MAP` alone.
import { describe, expect, it } from 'vitest';

import * as intelligence from '../../index.ts';
import { normaliseSection, normaliseStatute } from '../../issues/index.ts';
import {
  BNS,
  BNSS,
  BSA,
  CODE_MAP_VERSION,
  CRPC,
  ENRICH_VERSION,
  IEA,
  IPC,
  codeInForce,
  extractStatuteRefs,
} from '../enrich/index.ts';

import {
  NO_COUNTERPART_RECORDED,
  counterpart,
  sectionAt,
  sectionHistory,
  sectionKey,
  statuteKey,
  type SectionVersion,
} from './index.ts';

describe('section keys', () => {
  it('equal normaliseStatute/normaliseSection and the judgment_statute_ref keys', () => {
    expect(statuteKey('The Indian Penal Code, 1860')).toBe(
      normaliseStatute('The Indian Penal Code, 1860'),
    );
    expect(statuteKey('The Indian Penal Code')).toBe(IPC);
    expect(statuteKey('CrPC')).toBe(normaliseStatute('CrPC'));
    expect(statuteKey('Arbitration & Conciliation Act, 1996')).toBe(
      normaliseStatute('Arbitration & Conciliation Act, 1996'),
    );
    expect(sectionKey('Section 304 A')).toBe('304a');
    expect(sectionKey('s. 11 (6)')).toBe(normaliseSection('s. 11 (6)'));

    const [ref] = extractStatuteRefs([
      { pageNo: 1, text: 'an offence under Section 304A of the Indian Penal Code.' },
    ]);
    expect(ref).toMatchObject({
      statute: statuteKey('IPC'),
      section: sectionKey('Section 304 A'),
    });
  });

  it('resolves the evidence-law short forms the corpus uses', () => {
    expect(statuteKey('IEA')).toBe(IEA);
    expect(statuteKey('BSA')).toBe(BSA);
  });
});

describe('counterpart', () => {
  it('selects BNS for an offence on or after 2024-07-01', () => {
    expect(codeInForce('2024-07-01')).toBe('new');
    expect(codeInForce('2024-06-30')).toBe('old');
    const after = counterpart('IPC', '304A', '2024-07-01');
    expect(after).toMatchObject({
      kind: 'recorded',
      statute: IPC,
      section: '304a',
      codeInForce: 'new',
      counterparts: [{ statute: BNS, section: '106', inForce: true }],
    });
    const before = counterpart('IPC', '304A', '2024-06-30');
    expect(before).toMatchObject({
      codeInForce: 'old',
      counterparts: [{ statute: BNS, section: '106', inForce: false }],
    });
    expect(counterpart('BNS', '106(1)', '2024-07-01')).toMatchObject({
      counterparts: [{ statute: IPC, section: '304a', inForce: false }],
    });
    expect(counterpart('IPC', '304A')).toMatchObject({
      codeInForce: null,
      counterparts: [{ inForce: null }],
    });
  });

  it.each([
    ['IPC', '304A', BNS, '106'],
    ['BNS', '106', IPC, '304a'],
    ['Code of Criminal Procedure', 'Section 438', BNSS, '482'],
    ['BNSS', '482', CRPC, '438'],
    ['The Indian Evidence Act', '65B', BSA, '63'],
    ['Bharatiya Sakshya Adhiniyam', '63', IEA, '65b'],
  ])('%s %s resolves to %s %s', (statute, section, otherStatute, otherSection) => {
    const result = counterpart(statute, section);
    expect(result.kind).toBe('recorded');
    if (result.kind !== 'recorded') return;
    expect(result.counterparts.map((c) => [c.statute, c.section])).toEqual([
      [otherStatute, otherSection],
    ]);
  });

  it('says no counterpart is recorded for a section absent from the map, never a guess', () => {
    expect(counterpart('IPC', '999')).toEqual({
      kind: 'none',
      statute: IPC,
      section: '999',
      reason: NO_COUNTERPART_RECORDED,
    });
    expect(counterpart('Hindu Marriage Act, 1955', '13', '2025-01-01')).toEqual({
      kind: 'none',
      statute: 'hindu marriage act',
      section: '13',
      reason: 'no counterpart recorded',
    });
  });
});

describe('sectionAt', () => {
  const v1: SectionVersion = { text: 'original', valid_from: '1860-10-06', valid_to: '2013-02-03' };
  const v2: SectionVersion = {
    text: 'amended',
    valid_from: '2013-02-03',
    valid_to: null,
    amended_by: 'Criminal Law (Amendment) Act, 2013',
  };

  it('picks the version in force on a date, half-open, in any order', () => {
    for (const versions of [
      [v1, v2],
      [v2, v1],
    ]) {
      expect(sectionAt(versions, '2013-02-02')).toBe(v1);
      expect(sectionAt(versions, '2013-02-03')).toBe(v2);
      expect(sectionAt(versions, '2026-11-22')).toBe(v2);
      expect(sectionAt(versions, '1860-10-06')).toBe(v1);
      expect(sectionAt(versions, '1850-01-01')).toBeNull();
    }
    expect(sectionAt([v1], '2013-02-03')).toBeNull();
    expect(sectionAt([], '2020-01-01')).toBeNull();
  });

  it('orders the history and reports overlapping ranges', () => {
    expect(sectionHistory([v2, v1])).toEqual({ versions: [v1, v2], overlaps: [] });
    const bad: SectionVersion = { text: 'bad', valid_from: '2010-01-01', valid_to: '2014-01-01' };
    expect(sectionHistory([v1, v2, bad]).overlaps).toEqual([
      [v1, bad],
      [bad, v2],
    ]);
  });
});

describe('versions and exports', () => {
  it('leaves CODE_MAP_VERSION and ENRICH_VERSION unchanged', () => {
    expect(CODE_MAP_VERSION).toBe(1);
    expect(ENRICH_VERSION).toBe(1);
  });

  it('is exported from @causedeck/intelligence', () => {
    expect(intelligence.sectionAt).toBe(sectionAt);
    expect(intelligence.counterpart).toBe(counterpart);
    expect(intelligence.sectionHistory).toBe(sectionHistory);
    expect(intelligence.statuteKey).toBe(statuteKey);
    expect(intelligence.sectionKey).toBe(sectionKey);
    expect(intelligence.NO_COUNTERPART_RECORDED).toBe(NO_COUNTERPART_RECORDED);
  });
});
