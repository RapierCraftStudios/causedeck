import { afterEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('../src/health.ts', () => ({ logger: { warn, error: vi.fn(), info: vi.fn() } }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
  headers: () => Promise.resolve(new Headers()),
}));

const { loadMessages, missingKeyMode } = await import('../i18n/request.ts');
const { catalogs } = await import('./helpers/intl.ts');

afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockReset();
});

describe('i18n/request loadMessages (#174)', () => {
  it('loads the active locale from @causedeck/i18n', async () => {
    expect(await loadMessages('en')).toEqual(catalogs.en);
    expect(await loadMessages('kn')).toEqual(catalogs.kn);
  });

  it('shows keys in development and falls back to English in production', () => {
    expect(missingKeyMode()).toBe('development');
    vi.stubEnv('NODE_ENV', 'production');
    expect(missingKeyMode()).toBe('production');
  });

  it('in production returns a complete ta catalog without reporting gaps', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(await loadMessages('ta')).toEqual(catalogs.ta);
    expect(warn).not.toHaveBeenCalled();
  });
});
