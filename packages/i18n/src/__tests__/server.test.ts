import { describe, expect, it, vi } from 'vitest';

import { flattenKeys, getPath } from '../catalog';
import en from '../generated/messages/en.json';
import ta from '../generated/messages/ta.json';
import { loadMessages } from '../server';

describe('loadMessages', () => {
  it('returns only the requested locale', async () => {
    const messages = await loadMessages('en', { mode: 'production' });
    expect(messages).toEqual(en);
    const text = JSON.stringify(messages);
    expect(text).not.toMatch(/[஀-௿]/u); // Tamil block
    expect(text).not.toMatch(/[ಀ-೿]/u); // Kannada block
  });

  it('loads ta without English in development', async () => {
    expect(await loadMessages('ta', { mode: 'development' })).toEqual(ta);
  });

  it('fills production gaps from English and reports them', async () => {
    const report = vi.fn();
    const load = (locale: string) =>
      Promise.resolve(
        locale === 'en'
          ? { nav: { today: 'Today', tomorrow: 'Tomorrow' } }
          : { nav: { today: 'இன்று', tomorrow: '' } },
      );
    const messages = await loadMessages('ta', { mode: 'production', report, load });
    expect(messages).toEqual({ nav: { today: 'இன்று', tomorrow: 'Tomorrow' } });
    expect(report).toHaveBeenCalledWith({ locale: 'ta', missingKeys: ['nav.tomorrow'] });
  });

  it('dev keeps gaps so the UI shows the key', async () => {
    const load = (locale: string) =>
      Promise.resolve(locale === 'en' ? { nav: { today: 'Today' } } : { nav: {} });
    const messages = await loadMessages('kn', { mode: 'development', load });
    expect(getPath(messages, 'nav.today')).toBeUndefined();
  });

  it('the real ta catalog has no gaps to report', async () => {
    const report = vi.fn();
    const messages = await loadMessages('ta', { mode: 'production', report });
    expect(report).not.toHaveBeenCalled();
    expect(flattenKeys(messages).length).toBe(flattenKeys(en).length);
  });
});
