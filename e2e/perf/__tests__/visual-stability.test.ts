// Guards the stable-time helpers and their use in the visual specs (#1156): baselines must not
// depend on the weekday, the date or a slow font, so every spec that takes a screenshot runs with the
// browser clock frozen, and the specs that showed server-clock text pin it.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { settleFonts, type FontPage } from '../../fixtures/stable-time.ts';

const e2eRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(e2eRoot, rel), 'utf8');

function specs(dir: string): string[] {
  return readdirSync(join(e2eRoot, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => join(dir, f));
}

/** Screenshot specs outside `*.visual.spec.ts` whose shot carries no date, time or weekday text. */
const UNFROZEN_ALLOWED: Record<string, string> = {
  'tests/settings/owner-two-factor.spec.ts': 'the banner shot has no date text',
};

/** A stand-in at the browser boundary: runs the page function against a document with this `fonts.ready`. */
function pageWithFonts(ready: Promise<unknown>): FontPage {
  return {
    evaluate: (fn, ms) => {
      const g = globalThis as unknown as { document?: unknown };
      const before = g.document;
      g.document = { fonts: { ready } };
      return fn(ms).finally(() => {
        g.document = before;
      });
    },
  };
}

describe('stable-time helpers (#1156)', () => {
  it('exports disablePrompts, pinText and settleFonts and re-exports them from the fixtures', () => {
    const source = read('fixtures/stable-time.ts');
    for (const name of ['disablePrompts', 'pinText', 'settleFonts']) {
      expect(source).toContain(`export async function ${name}`);
      expect(read('fixtures/index.ts')).toContain(name);
    }
  });

  it('settleFonts resolves after the bound when fonts.ready never settles', async () => {
    const started = Date.now();
    await expect(settleFonts(pageWithFonts(new Promise<never>(() => undefined)), 50)).resolves.toBe(
      false,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('settleFonts resolves true when fonts are ready and false when the page throws', async () => {
    await expect(settleFonts(pageWithFonts(Promise.resolve()), 1000)).resolves.toBe(true);
    const broken: FontPage = {
      evaluate: () => Promise.reject(new Error('page closed')),
    };
    await expect(settleFonts(broken)).resolves.toBe(false);
  });

  it('freezes the clock for @visual tests and *.visual.spec.ts files', () => {
    const index = read('fixtures/index.ts');
    expect(index).toContain("testInfo.tags.includes('@visual')");
    expect(index).toContain("testInfo.file.endsWith('.visual.spec.ts')");
  });

  it('every screenshot spec is frozen by autoClock (@visual tag or *.visual.spec.ts name)', () => {
    const unfrozen = specs('tests').filter((rel) => {
      const source = read(rel);
      if (!source.includes('toHaveScreenshot')) return false;
      if (rel.endsWith('.visual.spec.ts') || source.includes("'@visual'")) return false;
      return !(rel in UNFROZEN_ALLOWED);
    });
    expect(unfrozen).toEqual([]);
  });

  it('the four server-clock specs pin their text', () => {
    for (const rel of [
      'tests/activity/audit-feed.spec.ts',
      'tests/activity/activity-feed.spec.ts',
    ]) {
      const source = read(rel);
      expect(source).toContain('pinText(');
      expect(source).toContain('settleFonts(');
    }
    const indic = read('tests/i18n/indic-rendering.spec.ts');
    expect(indic).toContain('disablePrompts(db.name)');
    expect(indic).toContain('pinText(');
    const calendar = read('tests/settings/calendar.spec.ts');
    expect(calendar).toContain('pinText(');
    expect(calendar).toContain('settleFonts(');
  });
});
