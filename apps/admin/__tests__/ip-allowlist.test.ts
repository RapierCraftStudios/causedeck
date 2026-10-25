import { describe, expect, it } from 'vitest';

import { clientIp, parseIpAllowlist } from '../lib/ip-allowlist.ts';

describe('parseIpAllowlist', () => {
  const allowed = parseIpAllowlist('203.0.113.7, 198.51.100.0/24, 2001:db8::/32');

  it('matches addresses, IPv4 CIDRs and IPv6 CIDRs', () => {
    expect(allowed('203.0.113.7')).toBe(true);
    expect(allowed('198.51.100.200')).toBe(true);
    expect(allowed('2001:db8::1')).toBe(true);
    expect(allowed('::ffff:198.51.100.9')).toBe(true);
  });

  it('rejects everything else, including a missing IP', () => {
    expect(allowed('203.0.113.8')).toBe(false);
    expect(allowed('198.51.101.1')).toBe(false);
    expect(allowed('2001:db9::1')).toBe(false);
    expect(allowed('not-an-ip')).toBe(false);
    expect(allowed(undefined)).toBe(false);
  });

  it.each(['10.0.0.0/33', 'example.com', '1.2.3', ''])('throws on %j', (raw) => {
    expect(() => parseIpAllowlist(raw)).toThrow(TypeError);
  });
});

describe('clientIp', () => {
  it('takes the first x-forwarded-for hop, else x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe(
      '203.0.113.7',
    );
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientIp(new Headers())).toBeUndefined();
  });
});
