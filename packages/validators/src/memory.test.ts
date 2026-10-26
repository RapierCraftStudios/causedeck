import { describe, expect, it } from 'vitest';

import {
  assertNotBench,
  readAlias,
  readAlwaysCarry,
  readBriefFormat,
  readClientLanguage,
  readClientUpdateStyle,
  isMemoryKey,
  isStrategyKey,
  layerOfKey,
  LAYER_SCOPES,
  MEMORY_KEYS,
  MEMORY_LAYERS,
  MemoryLayer,
  MemoryNoteInput,
  MemoryProposalInput,
} from './memory';

const MATTER = '5b1e1d0e-7a39-4c5e-9d6d-6f4b6f3c0a11';

describe('memory validators', () => {
  it('accepts only the six layers', () => {
    expect(MEMORY_LAYERS).toEqual(['M1', 'M2', 'M3', 'M4', 'M6', 'M7']);
    for (const bad of ['M5', 'M0', 'm1', ''])
      expect(MemoryLayer.safeParse(bad).success).toBe(false);
  });

  it('registers every key under its own layer prefix', () => {
    for (const [key, spec] of Object.entries(MEMORY_KEYS))
      expect(key.startsWith(`${spec.layer}.`)).toBe(true);
    expect(isMemoryKey('M2.always_carry')).toBe(true);
    expect(isMemoryKey('M5.playbook')).toBe(false);
  });

  it('checks scope against the layer and the matter id', () => {
    const ok = MemoryProposalInput.safeParse({
      key: 'M3.synopsis',
      value: 'A partition suit',
      scope: 'matter',
      matterId: MATTER,
    });
    expect(ok.success).toBe(true);
    expect(LAYER_SCOPES.M3).toEqual(['matter']);
    expect(
      MemoryProposalInput.safeParse({ key: 'M3.synopsis', value: 'x', scope: 'user' }).success,
    ).toBe(false);
    expect(
      MemoryProposalInput.safeParse({ key: 'M3.synopsis', value: 'x', scope: 'matter' }).success,
    ).toBe(false);
    expect(
      MemoryNoteInput.safeParse({
        key: 'M2.brief_format',
        value: 'x',
        scope: 'user',
        matterId: MATTER,
      }).success,
    ).toBe(false);
  });

  it('needs a person for M6 and rejects one elsewhere', () => {
    expect(
      MemoryNoteInput.safeParse({ key: 'M6.client_language', value: 'Tamil', scope: 'user' })
        .success,
    ).toBe(false);
    expect(
      MemoryNoteInput.safeParse({
        key: 'M6.client_language',
        value: 'Tamil',
        scope: 'user',
        personId: MATTER,
      }).success,
    ).toBe(true);
  });

  it('rejects unregistered keys', () => {
    expect(
      MemoryNoteInput.safeParse({ key: 'M2.unknown', value: 'x', scope: 'user' }).success,
    ).toBe(false);
  });

  it('rejects a judge or bench in a key or a value with a clear error', () => {
    expect(() => {
      assertNotBench('M4.judge_temperament', 'calm');
    }).toThrow(/judge or a bench/);
    expect(() => {
      assertNotBench('M4.hall_note', 'The judge dislikes adjournments');
    }).toThrow(/judge or a bench/);
    expect(() => {
      assertNotBench('M4.hall_note', ['fine', 'Bench of two prefers short notes']);
    }).toThrow(/judge or a bench/);
    expect(() => {
      assertNotBench('M4.hall_note', 'Court hall 4 opens at 10:15');
    }).not.toThrow();
  });
});

describe('M1.last_memory_review (#73)', () => {
  it('is a registered, non-strategy workspace-scope M1 key', () => {
    expect(isMemoryKey('M1.last_memory_review')).toBe(true);
    expect(layerOfKey('M1.last_memory_review')).toBe('M1');
    expect(isStrategyKey('M1.last_memory_review')).toBe(false);
    expect(
      MemoryNoteInput.safeParse({
        key: 'M1.last_memory_review',
        value: '2026-01-01T00:00:00.000Z',
        scope: 'workspace',
      }).success,
    ).toBe(true);
  });
});

describe('memory value readers (#74)', () => {
  it('reads a brief format and falls back on garbage', () => {
    expect(readBriefFormat('short')?.verbosity).toBe('short');
    expect(readBriefFormat({ order: 'carry, obligations' })?.order.slice(0, 2)).toEqual([
      'carry',
      'obligations',
    ]);
    expect(readBriefFormat('one page')).toBeNull();
    expect(readBriefFormat(['x'])).toBeNull();
  });

  it('reads always-carry rules, tone, language and aliases', () => {
    expect(readAlwaysCarry({ label: 'vakalat copy', when: 'first_hearing' })).toEqual([
      { label: 'vakalat copy', when: 'first_hearing' },
    ]);
    expect(readAlwaysCarry({ nope: 1 })).toEqual([]);
    expect(readClientUpdateStyle({ tone: 'Warm', sign_off: ' Regards ' })).toEqual({
      tone: 'warm',
      signOff: 'Regards',
    });
    expect(readClientLanguage('Tamil')).toBe('ta');
    expect(readClientLanguage('french')).toBeNull();
    expect(readAlias({ alias: 'Rajan', canonical: 'M. Rajan' })).toEqual({
      alias: 'Rajan',
      canonical: 'M. Rajan',
    });
    expect(readAlias('Rajan')).toBeNull();
  });
});
