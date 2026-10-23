import { describe, expect, it } from 'vitest';

import { costPaise, estimatePaise, estimateUsage } from '../pricing.ts';
import { getTask } from '../tasks/registry.ts';

const within1pc = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) / expected <= 0.01;

describe('pricing (paise)', () => {
  it('matches the documented unit-cost table within 1%', () => {
    // Haiku-class: USD 1 / 5 per million tokens at INR 84 -> 8400 / 42000 paise.
    expect(
      within1pc(
        costPaise('bedrock', 'apac.anthropic.claude-haiku', {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
        50_400,
      ),
    ).toBe(true);
    // Sonnet-class: USD 3 / 15 -> 25200 / 126000 paise.
    expect(
      within1pc(
        costPaise('bedrock', 'apac.anthropic.claude-sonnet', {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
        151_200,
      ),
    ).toBe(true);
    // Sarvam: STT INR 30/hour, OCR INR 1.50/page, translate INR 20 per 10k characters.
    expect(
      within1pc(
        costPaise('sarvam', 'stt', { inputTokens: 0, outputTokens: 0, seconds: 3_600 }),
        3_000,
      ),
    ).toBe(true);
    expect(costPaise('sarvam', 'ocr', { inputTokens: 0, outputTokens: 0, pages: 10 })).toBe(1_500);
    expect(
      within1pc(
        costPaise('sarvam', 'translate', { inputTokens: 0, outputTokens: 0, chars: 10_000 }),
        2_000,
      ),
    ).toBe(true);
  });

  it('prices the mock at zero and rounds up partial paise', () => {
    expect(costPaise('mock', 'mock', { inputTokens: 5_000, outputTokens: 5_000 })).toBe(0);
    expect(costPaise('bedrock', 'haiku', { inputTokens: 1, outputTokens: 0 })).toBe(1);
  });

  it('always yields an estimate: output cap plus input size, pages and seconds', () => {
    const usage = estimateUsage(getTask('ocr'), {
      contentBase64: 'AAAA',
      mimeType: 'application/pdf',
      pageCount: 4,
    });
    expect(usage).toMatchObject({ pages: 4, inputTokens: 0 });
    expect(
      estimatePaise('sarvam', 'ocr', getTask('ocr'), { pageCount: 4, contentBase64: 'AAAA' }),
    ).toBe(600);
    expect(
      estimatePaise('bedrock', 'haiku', getTask('summarise'), { text: 'x'.repeat(3_000) }),
    ).toBeGreaterThan(0);
  });
});
