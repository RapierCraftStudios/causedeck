import { describe, expect, it } from 'vitest';

import { amountInWords, numberInWordsIndian } from '../invoice/amount-in-words';

describe('amountInWords', () => {
  it('spells rupees and paise', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
    expect(amountInWords(1)).toBe('Rupees Zero and One Paisa Only');
    expect(amountInWords(100)).toBe('Rupees One Only');
    expect(amountInWords(118_000)).toBe('Rupees One Thousand One Hundred Eighty Only');
    expect(amountInWords(118_050)).toBe(
      'Rupees One Thousand One Hundred Eighty and Fifty Paise Only',
    );
    expect(amountInWords(117_882)).toBe(
      'Rupees One Thousand One Hundred Seventy Eight and Eighty Two Paise Only',
    );
  });

  it('groups in lakh and crore', () => {
    expect(amountInWords(100_000_00)).toBe('Rupees One Lakh Only');
    expect(amountInWords(99_999_99)).toBe(
      'Rupees Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only',
    );
    expect(amountInWords(1_00_00_000_00)).toBe('Rupees One Crore Only');
    expect(amountInWords(12_34_56_789_01)).toBe(
      'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine and One Paisa Only',
    );
    expect(numberInWordsIndian(1_00_00_00_000)).toBe('One Hundred Crore');
    expect(numberInWordsIndian(10_010)).toBe('Ten Thousand Ten');
  });

  it('rejects negative, fractional and unsafe input', () => {
    expect(() => amountInWords(-1)).toThrow(RangeError);
    expect(() => amountInWords(1.5)).toThrow(RangeError);
    expect(() => amountInWords(Number.NaN)).toThrow(RangeError);
    expect(() => amountInWords(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => numberInWordsIndian(-3)).toThrow(RangeError);
  });
});
