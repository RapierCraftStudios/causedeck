import { describe, expect, it } from 'vitest';

import {
  AlwaysCarryValue,
  assertNotBench,
  BriefFormatValue,
  ClientUpdateStyleValue,
  MatchingHintInput,
  OutwardLanguage,
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
  PlaybookSchema,
  PRECEDENT_DISMISS_REST_DAYS,
  PrecedentProposalSchema,
} from './memory';

const MATTER = '5b1e1d0e-7a39-4c5e-9d6d-6f4b6f3c0a11';

describe('M5 validators (#901)', () => {
  const VERSION = '7c1e1d0e-7a39-4c5e-9d6d-6f4b6f3c0a22';

  it('lets M5 live at user or workspace scope, never matter scope', () => {
    expect(LAYER_SCOPES.M5).toEqual(['user', 'workspace']);
    expect(
      MemoryNoteInput.safeParse({ key: 'M5.playbook', value: 'x', scope: 'matter', matterId: MATTER })
        .success,
    ).toBe(false);
    expect(MemoryNoteInput.safeParse({ key: 'M5.precedent', value: 'x', scope: 'user' }).success).toBe(
      true,
    );
  });

  it("allows the court's honorific in a passage but still refuses a bench key", () => {
    expect(() =>
      assertNotBench('M5.precedent', "It is prayed that this Hon'ble Court may be pleased to allow"),
    ).not.toThrow();
    expect(() => assertNotBench('M3.synopsis', "The Hon'ble judge is strict")).toThrow();
    expect(() => assertNotBench('M5.judge_notes', 'x')).toThrow();
  });

  it('parses a precedent proposal with its source anchor and a 30-day rest', () => {
    const ok = PrecedentProposalSchema.safeParse({
      passageText: 'It is therefore prayed that this Court may be pleased to allow the petition.',
      kind: 'prayer',
      courtId: null,
      sourceAnchor: { draftVersionId: VERSION, anchorId: 'b.2' },
      confidence: 0.8,
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.language).toBe('en');
    expect(
      PrecedentProposalSchema.safeParse({
        passageText: 'x',
        kind: 'poem',
        courtId: null,
        sourceAnchor: { draftVersionId: VERSION, anchorId: 'b.2' },
        confidence: 1,
      }).success,
    ).toBe(false);
    expect(PRECEDENT_DISMISS_REST_DAYS).toBe(30);
  });

  it('bounds a playbook', () => {
    const base = { name: 'HC writs', courtId: null, format: 'writ', standardPrayers: ['a'], annexureOrder: [] };
    expect(PlaybookSchema.safeParse(base).success).toBe(true);
    expect(PlaybookSchema.safeParse({ ...base, standardPrayers: Array(11).fill('a') }).success).toBe(
      false,
    );
  });
});

describe('memory validators', () => {
  it('accepts only the seven layers', () => {
    expect(MEMORY_LAYERS).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']);
    for (const bad of ['M8', 'M0', 'm1', ''])
      expect(MemoryLayer.safeParse(bad).success).toBe(false);
  });

  it('registers every key under its own layer prefix', () => {
    for (const [key, spec] of Object.entries(MEMORY_KEYS))
      expect(key.startsWith(`${spec.layer}.`)).toBe(true);
    expect(isMemoryKey('M2.always_carry')).toBe(true);
    expect(isMemoryKey('M5.playbook')).toBe(true);
    expect(isMemoryKey('M5.judge_habits')).toBe(false);
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

describe('memory value schemas (#74, R14)', () => {
  it('parses each readable shape with the exported zod schemas', () => {
    expect(BriefFormatValue.safeParse(' Short ').data).toBe('short');
    expect(BriefFormatValue.safeParse('one page').success).toBe(false);
    expect(AlwaysCarryValue.safeParse(['a', 'b']).data).toEqual([
      { label: 'a', when: 'always' },
      { label: 'b', when: 'always' },
    ]);
    expect(ClientUpdateStyleValue.safeParse('formal').data).toEqual({ tone: 'formal' });
    expect(ClientUpdateStyleValue.safeParse(42).success).toBe(false);
    expect(OutwardLanguage.safeParse('Kannada').data).toBe('kn');
    expect(OutwardLanguage.safeParse('french').success).toBe(false);
  });

  it('validates a matching hint input strictly', () => {
    expect(MatchingHintInput.parse({ alias: 'Rajan', canonical: 'M. Rajan' }).target).toBe('party');
    expect(MatchingHintInput.safeParse({ alias: '', canonical: 'x' }).success).toBe(false);
    expect(MatchingHintInput.safeParse({ alias: 'a', canonical: 'b', extra: 1 }).success).toBe(
      false,
    );
  });
});
