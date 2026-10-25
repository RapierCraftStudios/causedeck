import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_SELECTED_MESSAGES,
  isWhatsAppSelectionError,
  validateSelection,
  type ValidateSelectionInput,
} from '../validate-selection.ts';

const fixture = (name: string): string =>
  readFileSync(path.resolve(import.meta.dirname, '../../../fixtures/whatsapp', name), 'utf8');

const base = (over: Partial<ValidateSelectionInput> = {}): ValidateSelectionInput => ({
  text: fixture('pii.txt'),
  chatType: 'internal',
  expectedChatType: 'internal',
  selectedIndexes: [0, 1, 2, 3, 4, 5, 6],
  ...over,
});

const codeOf = (input: ValidateSelectionInput): string | undefined => {
  try {
    validateSelection(input);
  } catch (error) {
    return isWhatsAppSelectionError(error) ? error.code : 'other';
  }
  return undefined;
};

describe('validateSelection', () => {
  it('re-applies the exclusion rules even when the client selected everything', () => {
    const out = validateSelection(base({ sensitiveCaseNumbers: ['CRL.A. 123/2026'] }));
    expect(out.messages.map((m) => m.text)).toEqual(['Lunch at 1?']);
    expect(out.excluded).toHaveLength(6);
    expect(out.dateOrder).toBe('dmy');
  });

  it('honours confirmations for overridable rules only', () => {
    const out = validateSelection(base({ confirmedIndexes: [0, 1, 2, 3, 4, 5, 6] }));
    expect(out.excluded.map((e) => e.index)).toEqual([0, 3]);
  });

  it('returns only the selected messages, in export order', () => {
    const out = validateSelection(base({ selectedIndexes: [6, 6] }));
    expect(out.messages.map((m) => m.index)).toEqual([6]);
  });

  it('rejects a chat-type mismatch', () => {
    expect(codeOf(base({ chatType: 'client' }))).toBe('chat_type_mismatch');
  });

  it('rejects an oversize export per the txt cap, honouring overrides', () => {
    expect(codeOf(base({ sizeCapsBytes: { txt: 10 } }))).toBe('too_large');
    expect(codeOf(base({ sizeCapsBytes: { txt: 10_000 } }))).toBeUndefined();
  });

  it('rejects more than 5,000 selected messages but accepts exactly 5,000', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => i % 7);
    expect(MAX_SELECTED_MESSAGES).toBe(5000);
    expect(codeOf(base({ selectedIndexes: many(5001) }))).toBe('too_many_messages');
    expect(codeOf(base({ selectedIndexes: many(5000) }))).toBeUndefined();
  });

  it('rejects empty, out-of-range and non-integer selections and non-exports', () => {
    expect(codeOf(base({ selectedIndexes: [] }))).toBe('empty_selection');
    expect(codeOf(base({ selectedIndexes: [99] }))).toBe('invalid_selection');
    expect(codeOf(base({ selectedIndexes: [-1] }))).toBe('invalid_selection');
    expect(codeOf(base({ selectedIndexes: [1.5] }))).toBe('invalid_selection');
    expect(codeOf(base({ text: 'just some text' }))).toBe('not_a_chat_export');
  });

  it('uses the supplied date order', () => {
    const out = validateSelection(
      base({ text: '03/04/2026, 10:01 - A: hi', selectedIndexes: [0], dateOrder: 'mdy' }),
    );
    expect(out.messages[0]?.at).toBe('2026-03-04T10:01:00');
  });
});
