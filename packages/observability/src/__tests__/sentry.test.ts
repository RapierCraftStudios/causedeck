import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { beforeSend, initSentry } from '../sentry.ts';

afterEach(async () => {
  await Sentry.close(0);
  vi.restoreAllMocks();
});

describe('initSentry', () => {
  it('does nothing without a DSN: no init, no network, no warnings', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    expect(initSentry({ dsn: undefined })).toBe(false);
    expect(initSentry({ dsn: '' })).toBe(false);
    // Default: env has SENTRY_ENABLED=false.
    expect(initSentry()).toBe(false);

    expect(Sentry.isInitialized()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('scrubs cookies, headers, bodies and user email before sending (stub transport)', async () => {
    const sent: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const transport = () =>
      Sentry.createTransport({ recordDroppedEvent: () => undefined }, (request) => {
        sent.push(
          typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body),
        );
        return Promise.resolve({ statusCode: 200 });
      });

    expect(initSentry({ dsn: 'https://public@o0.ingest.example.invalid/1', transport })).toBe(true);
    Sentry.setUser({ id: 'u1', email: 'lawyer@example.com' });
    Sentry.captureEvent({
      message: 'failed with token=abc123',
      request: {
        url: 'https://app.example/matters',
        cookies: { session: 'cookie-value' },
        headers: { authorization: 'Bearer header-secret' },
        data: { content: 'privileged text' },
      },
    });
    await Sentry.flush(2000);

    const payload = sent.join('\n');
    expect(payload).toContain('failed with token=');
    for (const leaked of [
      'lawyer@example.com',
      'cookie-value',
      'header-secret',
      'privileged text',
      'abc123',
    ]) {
      expect(payload).not.toContain(leaked);
    }
    expect(payload).toContain('"id":"u1"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('beforeSend', () => {
  it('removes request cookies, headers, data and user email', () => {
    const event = {
      type: undefined,
      request: { cookies: { a: 'b' }, headers: { c: 'd' }, data: 'body', url: '/x' },
      user: { id: '1', email: 'e@example.com' },
      exception: { values: [{ type: 'Error', value: 'Bearer abc' }] },
    } as ErrorEvent;

    const out = beforeSend(event);

    expect(out.request).toEqual({ url: '/x' });
    expect(out.user).toEqual({ id: '1' });
    expect(out.exception?.values?.[0]?.value).not.toContain('abc');
  });
});
