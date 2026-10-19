import { describe, expect, it, vi } from 'vitest';

import { createMissingKeyHandlers } from '../missing';

const missing = { code: 'MISSING_MESSAGE', message: 'MISSING_MESSAGE: Could not resolve `nav.x`' };
const english = { nav: { today: 'Today', reference: ['Ref: ', ['digest']] } };

describe('missing keys in development', () => {
  it('shows the dotted key and warns, without reporting', () => {
    const warn = vi.fn();
    const report = vi.fn();
    const handlers = createMissingKeyHandlers({
      mode: 'development',
      fallback: english,
      report,
      warn,
    });
    expect(handlers.getMessageFallback({ namespace: 'nav', key: 'today', error: missing })).toBe(
      'nav.today',
    );
    handlers.onError(missing);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MISSING_MESSAGE'));
    expect(report).not.toHaveBeenCalled();
  });

  it('still reports formatting errors', () => {
    const report = vi.fn();
    const handlers = createMissingKeyHandlers({ mode: 'development', report, warn: vi.fn() });
    handlers.onError({ code: 'FORMATTING_ERROR', message: 'bad' });
    expect(report).toHaveBeenCalledWith({ code: 'FORMATTING_ERROR', message: 'bad' });
  });

  it('defaults to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createMissingKeyHandlers({ mode: 'development', report: vi.fn() }).onError(missing);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('missing keys in production', () => {
  it('falls back to English and reports to the logger', () => {
    const report = vi.fn();
    const handlers = createMissingKeyHandlers({ mode: 'production', fallback: english, report });
    expect(handlers.getMessageFallback({ namespace: 'nav', key: 'today', error: missing })).toBe(
      'Today',
    );
    handlers.onError(missing);
    expect(report).toHaveBeenCalledWith({ code: 'MISSING_MESSAGE', message: missing.message });
  });

  it('never returns an empty string', () => {
    const handlers = createMissingKeyHandlers({
      mode: 'production',
      fallback: { nav: { blank: '' } },
      report: vi.fn(),
    });
    for (const key of ['blank', 'absent', 'reference']) {
      const text = handlers.getMessageFallback({ namespace: 'nav', key, error: missing });
      expect(text).toBe(`nav.${key}`);
    }
    expect(
      createMissingKeyHandlers({ mode: 'production', report: vi.fn() }).getMessageFallback({
        key: 'top',
        error: missing,
      }),
    ).toBe('top');
  });
});
