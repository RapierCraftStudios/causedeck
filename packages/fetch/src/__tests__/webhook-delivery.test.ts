// Customer webhook delivery guard (#626): https only, public addresses only, no redirects, timeout.
import { describe, expect, it, vi } from 'vitest';

import { deliverWebhook, isBlockedAddress, WebhookDeliveryError } from '../webhook-delivery.ts';

const request = { body: '{"a":1}', headers: { 'x-causedeck-signature': 'v1=abc' } };
const publicHost = () => Promise.resolve(['93.184.216.34']);

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('deliverWebhook', () => {
  it('posts the body with the signature headers to a public https host and returns the status', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const result = await deliverWebhook('https://hooks.example.com/in', request, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: publicHost,
    });
    expect(result).toEqual({ status: 204 });
    const [target, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(target.toString()).toBe('https://hooks.example.com/in');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.body).toBe(request.body);
    expect(init.headers).toMatchObject({
      'x-causedeck-signature': 'v1=abc',
      'content-type': 'application/json',
    });
  });

  it.each([
    ['http://hooks.example.com/in', 'invalid_url'],
    ['https://user:pw@hooks.example.com/in', 'invalid_url'],
    ['not a url', 'invalid_url'],
    ['https://127.0.0.1/in', 'blocked_address'],
    ['https://[::1]/in', 'blocked_address'],
    ['https://169.254.169.254/latest', 'blocked_address'],
  ])('refuses %s before any network call', async (url, reason) => {
    const fetchImpl = vi.fn();
    await expect(
      deliverWebhook(url, request, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ reason });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a host that resolves to a private address, or to nothing', async () => {
    const fetchImpl = vi.fn();
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch };
    await expect(
      deliverWebhook('https://internal.example.com/in', request, {
        ...opts,
        resolve: () => Promise.resolve(['93.184.216.34', '10.0.0.5']),
      }),
    ).rejects.toMatchObject({ reason: 'blocked_address' });
    await expect(
      deliverWebhook('https://nowhere.example.com/in', request, {
        ...opts,
        resolve: () => Promise.reject(new Error('ENOTFOUND')),
      }),
    ).rejects.toMatchObject({ reason: 'unresolvable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns a redirect as a status and never follows it', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: 'https://10.0.0.1' } }),
      ),
    );
    await expect(
      deliverWebhook('https://hooks.example.com/in', request, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolve: publicHost,
      }),
    ).resolves.toEqual({ status: 302 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps a timeout and a network failure to typed errors', async () => {
    const timeout = vi.fn(() =>
      Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
    );
    await expect(
      deliverWebhook('https://hooks.example.com/in', request, {
        fetchImpl: timeout as unknown as typeof fetch,
        resolve: publicHost,
      }),
    ).rejects.toMatchObject({ reason: 'timeout' });
    const down = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    const error = await deliverWebhook('https://hooks.example.com/in', request, {
      fetchImpl: down as unknown as typeof fetch,
      resolve: publicHost,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookDeliveryError);
    expect(error).toMatchObject({ reason: 'network' });
  });
});
