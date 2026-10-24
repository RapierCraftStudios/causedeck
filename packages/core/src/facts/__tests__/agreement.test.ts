import { describe, expect, it } from 'vitest';

import { assessAgreement, UNKNOWN_CONFIDENCE } from '../agreement.ts';

const obs = (sourceType: string, value: string, confidence: number | null, sourceRef = '') => ({
  sourceType,
  sourceRef: sourceRef === '' ? null : sourceRef,
  value,
  confidence,
});

describe('assessAgreement', () => {
  it('reports one source as single, with its own confidence', () => {
    const a = assessAgreement([obs('adapter', '2026-11-02', 0.8, 'https://court/x')]);
    expect(a.status).toBe('single');
    expect(a.confidence).toBe(0.8);
    expect(a.value).toBe('2026-11-02');
  });

  it('raises confidence when independent sources agree', () => {
    const single = assessAgreement([obs('adapter', '2026-11-02', 0.8, 'u')]);
    const agree = assessAgreement([
      obs('adapter', '2026-11-02', 0.8, 'u'),
      obs('document', '2026-11-02', 0.6, 'doc'),
      obs('capture', '2026-11-02', null, 'voice'),
    ]);
    expect(agree.status).toBe('agree');
    expect(agree.sources).toHaveLength(3);
    expect(agree.confidence).toBeGreaterThan(single.confidence);
    expect(agree.confidence).toBeLessThanOrEqual(1);
  });

  it('turns two disagreeing sources into one conflict and discounts the confidence', () => {
    const single = assessAgreement([obs('adapter', '2026-11-02', 0.8, 'u')]);
    const conflict = assessAgreement([
      obs('adapter', '2026-11-02', 0.8, 'u'),
      obs('capture', '2026-11-09', 0.7, 'voice'),
    ]);
    expect(conflict.status).toBe('conflict');
    expect(conflict.groups.map((g) => g.value)).toEqual(['2026-11-02', '2026-11-09']);
    expect(conflict.value).toBe('2026-11-02');
    expect(conflict.confidence).toBeLessThan(single.confidence);
  });

  it('counts one source once and gives a missing confidence a neutral weight', () => {
    const a = assessAgreement([
      obs('adapter', '2026-11-02', null, 'u'),
      obs('adapter', '2026-11-09', 0.9, 'u'),
    ]);
    expect(a.status).toBe('single');
    expect(a.value).toBe('2026-11-02');
    expect(a.confidence).toBe(UNKNOWN_CONFIDENCE);
  });

  it('handles no observations', () => {
    expect(assessAgreement([])).toMatchObject({ status: 'single', value: null, confidence: 0 });
  });
});
