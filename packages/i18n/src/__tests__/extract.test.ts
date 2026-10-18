import { describe, expect, it } from 'vitest';

import { extractFromSources, extractKeys } from '../../scripts/extract';

describe('extractKeys', () => {
  it('qualifies literal calls with the namespace of the closest binding', () => {
    const source = `
      function A() { const t = useTranslations('shell.sidebar'); return t('synced'); }
      function B() { const t = useTranslations('shell'); return t("sidebar.label") + t(\`roles.\${x}\`); }
      async function C() { const tc = await getTranslations('common'); return tc.rich('loading'); }
      function D() { const t = useTranslations(); return t('nav.today'); }
    `;
    expect(extractKeys(source)).toEqual([
      'common.loading',
      'nav.today',
      'shell.sidebar.label',
      'shell.sidebar.synced',
    ]);
  });

  it('ignores calls on other objects', () => {
    expect(extractKeys(`const t = useTranslations('a'); obj.t('x'); at('y');`)).toEqual([]);
  });
});

describe('extractFromSources', () => {
  it('lists used keys missing from en and unreferenced en keys', () => {
    const result = extractFromSources(
      { 'page.tsx': `const t = useTranslations('nav'); t('today'); t('nope');` },
      { nav: { today: 'Today', tomorrow: 'Tomorrow' } },
    );
    expect(result.missing).toEqual([{ id: 'nav.nope', file: 'page.tsx' }]);
    expect(result.unreferenced).toEqual(['nav.tomorrow']);
  });
});
