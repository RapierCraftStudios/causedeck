import { describe, expect, it } from 'vitest';

import {
  assertNotBench,
  isMemoryKey,
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
    for (const bad of ['M5', 'M0', 'm1', '']) expect(MemoryLayer.safeParse(bad).success).toBe(false);
  });

  it('registers every key under its own layer prefix', () => {
    for (const [key, spec] of Object.entries(MEMORY_KEYS)) expect(key.startsWith(`${spec.layer}.`)).toBe(true);
    expect(isMemoryKey('M2.always_carry')).toBe(true);
    expect(isMemoryKey('M5.playbook')).toBe(false);
  });

  it('checks scope against the layer and the matter id', () => {
    const ok = MemoryProposalInput.safeParse({ key: 'M3.synopsis', value: 'A partition suit', scope: 'matter', matterId: MATTER });
    expect(ok.success).toBe(true);
    expect(LAYER_SCOPES.M3).toEqual(['matter']);
    expect(MemoryProposalInput.safeParse({ key: 'M3.synopsis', value: 'x', scope: 'user' }).success).toBe(false);
    expect(MemoryProposalInput.safeParse({ key: 'M3.synopsis', value: 'x', scope: 'matter' }).success).toBe(false);
    expect(MemoryNoteInput.safeParse({ key: 'M2.brief_format', value: 'x', scope: 'user', matterId: MATTER }).success).toBe(false);
  });

  it('needs a person for M6 and rejects one elsewhere', () => {
    expect(MemoryNoteInput.safeParse({ key: 'M6.client_language', value: 'Tamil', scope: 'user' }).success).toBe(false);
    expect(MemoryNoteInput.safeParse({ key: 'M6.client_language', value: 'Tamil', scope: 'user', personId: MATTER }).success).toBe(true);
  });

  it('rejects unregistered keys', () => {
    expect(MemoryNoteInput.safeParse({ key: 'M2.unknown', value: 'x', scope: 'user' }).success).toBe(false);
  });

  it('rejects a judge or bench in a key or a value with a clear error', () => {
    expect(() => assertNotBench('M4.judge_temperament', 'calm')).toThrow(/judge or a bench/);
    expect(() => assertNotBench('M4.hall_note', 'The judge dislikes adjournments')).toThrow(/judge or a bench/);
    expect(() => assertNotBench('M4.hall_note', ['fine', 'Bench of two prefers short notes'])).toThrow(/judge or a bench/);
    expect(() => assertNotBench('M4.hall_note', 'Court hall 4 opens at 10:15')).not.toThrow();
  });
});
