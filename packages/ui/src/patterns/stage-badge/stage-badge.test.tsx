// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { evaluateContrast } from '../../../scripts/check-contrast';
import { STAGES as TOKEN_STAGES } from '../../../scripts/lib/parse-tokens';
import { LISTING_STAGES, PROCEEDING_STAGES } from '../types';
import { StageBadge } from './stage-badge';
import { STAGE_MAP, STAGE_ORDER } from './stage-map';

describe('StageBadge', () => {
  it('covers every proceeding stage plus the listing stages', () => {
    expect(PROCEEDING_STAGES).toEqual([
      'filed',
      'sr_fr',
      'defects',
      're_presented',
      'numbered',
      'disposed',
    ]);
    expect(Object.keys(STAGE_MAP)).toEqual([...PROCEEDING_STAGES, ...LISTING_STAGES]);
    expect([...STAGE_ORDER].sort()).toEqual([...TOKEN_STAGES].sort());
  });

  it('uses plain court terms', () => {
    expect(STAGE_ORDER.map((s) => STAGE_MAP[s].label)).toEqual([
      'Filed',
      'SR',
      'Defects',
      'Re-presented',
      'Numbered',
      'Disposed',
      'Listed',
      'Reserved',
      'Part-heard',
    ]);
  });

  it.each(STAGE_ORDER)('%s renders icon, label and token colours', (stage) => {
    const { container } = render(<StageBadge stage={stage} />);
    const badge = container.querySelector('[data-slot="stage-badge"]');
    expect(badge).toHaveAttribute('data-stage', stage);
    expect(badge).toHaveTextContent(STAGE_MAP[stage].label);
    expect(badge?.querySelector('[data-slot="stage-icon"]')).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveClass(`bg-stage-${stage}-soft`, `text-stage-${stage}`);
    expect(STAGE_MAP[stage].token).toBe(`stage-${stage}`);
  });

  it('meets 4.5:1 contrast in both themes (#7 check script)', () => {
    const pairs = STAGE_ORDER.map((stage) => ({
      fg: STAGE_MAP[stage].token,
      bg: `${STAGE_MAP[stage].token}-soft`,
      kind: 'text' as const,
    }));
    const results = evaluateContrast(undefined, pairs);
    expect(results).toHaveLength(STAGE_ORDER.length * 2);
    for (const r of results) {
      expect(r.ratio, `${r.fg} on ${r.bg} (${r.theme})`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
