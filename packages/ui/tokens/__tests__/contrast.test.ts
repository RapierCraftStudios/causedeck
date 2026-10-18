import {
  differenceCiede2000,
  filterDeficiencyDeuter,
  filterDeficiencyProt,
  filterDeficiencyTrit,
  type Color,
} from 'culori';
import { describe, expect, it } from 'vitest';

import { colorOf, evaluateContrast, THRESHOLDS } from '../../scripts/check-contrast';
import { CHART_COUNT, STAGES, loadThemes, resolveValue } from '../../scripts/lib/parse-tokens';

const themes = loadThemes();
const results = evaluateContrast(themes);
const describeResult = (r: (typeof results)[number]): string =>
  `${r.theme} ${r.fg} on ${r.bg}: ${String(r.ratio)}:1 (${r.kind}, needs ${String(THRESHOLDS[r.kind].min)}:1)`;

describe('contrast gates', () => {
  it('checks every pair in both themes', () => {
    expect(results.filter((r) => r.theme === 'light').length).toBeGreaterThanOrEqual(90);
    expect(results.filter((r) => r.theme === 'dark').length).toBe(
      results.filter((r) => r.theme === 'light').length,
    );
  });

  it('has no text below 4.5:1 and no UI or large text below 3:1', () => {
    expect(results.filter((r) => r.status === 'fail').map(describeResult)).toEqual([]);
  });

  it('meets AAA 7:1 for body text on every surface', () => {
    const body = results.filter((r) => r.kind === 'body');
    expect(body.length).toBeGreaterThan(0);
    expect(body.filter((r) => r.ratio < 7).map(describeResult)).toEqual([]);
  });

  it('keeps the focus ring at >= 3:1 against both adjacent surfaces', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const bg of ['surface', 'surface-raised']) {
        const pair = results.find((r) => r.theme === theme && r.fg === 'ring' && r.bg === bg);
        expect(pair, `${theme} ring on ${bg}`).toBeDefined();
        expect(pair?.ratio).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('stage colours', () => {
  const lightness = (value: string): number => Number(/oklch\(([\d.]+)/.exec(value)?.[1]);

  it.each(['light', 'dark'] as const)('share one lightness per role in %s', (theme) => {
    const map = themes[theme];
    const fg = new Set(STAGES.map((s) => lightness(resolveValue(`var(--stage-${s})`, map))));
    const soft = new Set(STAGES.map((s) => lightness(resolveValue(`var(--stage-${s}-soft)`, map))));
    expect(fg.size).toBe(1);
    expect(soft.size).toBe(1);
  });
});

describe('chart palette', () => {
  const MIN_DELTA_E = 12;
  const delta = differenceCiede2000();
  const vision: [string, (c: Color) => Color][] = [
    ['normal', (c) => c],
    ['protanopia', filterDeficiencyProt(1)],
    ['deuteranopia', filterDeficiencyDeuter(1)],
    ['tritanopia', filterDeficiencyTrit(1)],
  ];

  it.each(['light', 'dark'] as const)(
    'keeps every series pair distinguishable under colour-vision deficiency in %s',
    (theme) => {
      const colours = Array.from({ length: CHART_COUNT }, (_, i) =>
        colorOf(`chart-${String(i + 1)}`, themes[theme]),
      );
      const tooClose: string[] = [];
      for (const [name, simulate] of vision) {
        for (let i = 0; i < colours.length; i++) {
          for (let j = i + 1; j < colours.length; j++) {
            const d = delta(simulate(colours[i] as Color), simulate(colours[j] as Color));
            if (d < MIN_DELTA_E)
              tooClose.push(`${name} chart-${String(i + 1)}/chart-${String(j + 1)}: ${String(d)}`);
          }
        }
      }
      expect(tooClose).toEqual([]);
    },
  );
});
