import { describe, expect, it } from 'vitest';

import { BUILT_IN_PROVIDERS, providerFromTemplate, validateProviderTemplate } from './providers.ts';

describe('validateProviderTemplate', () => {
  it('accepts an https template and returns its host', () => {
    expect(validateProviderTemplate('https://www.scconline.com/search?q={q}')).toEqual({
      ok: true,
      host: 'www.scconline.com',
    });
  });

  it.each([
    'javascript:alert(1)//{q}',
    'data:text/html,{q}',
    'http://www.scconline.com/?q={q}',
    'file:///etc/passwd?{q}',
    'https://user:pw@example.com/?q={q}',
    'https://example.com:8443/?q={q}',
    'https://{q}.example.com/',
    'https://example.com/?q=1',
    'https://exa mple.com/?q={q}',
    'https://example.com\\@evil.test/?q={q}',
    'https://localhost/?q={q}',
    '',
  ])('rejects %s', (template) => {
    expect(validateProviderTemplate(template).ok).toBe(false);
  });

  it('has built-in providers that validate and match their own host', () => {
    for (const p of BUILT_IN_PROVIDERS) {
      expect(validateProviderTemplate(p.urlTemplate)).toEqual({ ok: true, host: p.host });
    }
    expect(BUILT_IN_PROVIDERS.map((p) => p.key)).not.toContain('scc-online');
  });

  it('turns only a valid row into a provider', () => {
    const row = { key: 'm', label: 'Manupatra', urlTemplate: 'https://www.manupatra.com/s?q={q}' };
    expect(providerFromTemplate(row)?.host).toBe('www.manupatra.com');
    expect(providerFromTemplate({ ...row, urlTemplate: 'javascript:1//{q}' })).toBeNull();
  });
});
