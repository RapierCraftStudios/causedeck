// Gate, kill-switch names and page cache of bulk captcha solving (#492).
import { describe, expect, it } from 'vitest';

import {
  bulkCaptchaGate,
  createPageCache,
  hostKillSwitchName,
  killSwitchesFromMap,
  type BulkKillSwitches,
} from '../index.ts';

const off: BulkKillSwitches = { global: () => false, host: () => false };
const HOST = 'hcservices.ecourts.gov.in';

describe('bulkCaptchaGate', () => {
  it('runs only with the clearance flag and an approval reference', () => {
    expect(
      bulkCaptchaGate(
        { captchaBulkCleared: true, captchaBulkApprovalRef: 'OPINION-118-A' },
        HOST,
        off,
      ),
    ).toBeNull();
    expect(
      bulkCaptchaGate(
        { captchaBulkCleared: false, captchaBulkApprovalRef: 'OPINION-118-A' },
        HOST,
        off,
      ),
    ).toBe('not_cleared');
    expect(
      bulkCaptchaGate({ captchaBulkCleared: true, captchaBulkApprovalRef: null }, HOST, off),
    ).toBe('approval_ref_missing');
    expect(bulkCaptchaGate({ captchaBulkCleared: true }, HOST, off)).toBe('approval_ref_missing');
    expect(
      bulkCaptchaGate({ captchaBulkCleared: true, captchaBulkApprovalRef: '  ' }, HOST, off),
    ).toBe('approval_ref_missing');
  });

  it('a kill switch wins over a valid clearance', () => {
    const policy = { captchaBulkCleared: true, captchaBulkApprovalRef: 'OPINION-118-A' };
    expect(bulkCaptchaGate(policy, HOST, { ...off, global: () => true })).toBe('kill_switch');
    expect(bulkCaptchaGate(policy, HOST, { ...off, host: (h) => h === HOST })).toBe('host_killed');
    expect(
      bulkCaptchaGate(policy, 'other.example.in', { ...off, host: (h) => h === HOST }),
    ).toBeNull();
  });

  it('reads the switches from the parsed KILL_ map on every call', () => {
    let map: Record<string, boolean> | undefined = {};
    const kill = killSwitchesFromMap(() => map);
    expect(hostKillSwitchName(HOST)).toBe('KILL_CAPTCHA_BULK_HOST_HCSERVICES_ECOURTS_GOV_IN');
    expect(kill.global()).toBe(false);
    map = { KILL_CAPTCHA_BULK: true };
    expect(kill.global()).toBe(true);
    map = { [hostKillSwitchName(HOST)]: true };
    expect(kill.global()).toBe(false);
    expect(kill.host(HOST)).toBe(true);
    map = undefined;
    expect(kill.host(HOST)).toBe(false);
  });
});

describe('page cache', () => {
  it('serves fresh, goes stale after the window, and recognises an unchanged hash', () => {
    let now = 1_000;
    const cache = createPageCache({ now: () => now, freshnessMs: 100 });
    const page = { status: 200, body: '<html>list</html>', contentType: 'text/html', etag: '"v1"' };
    expect(cache.lookup('u').state).toBe('miss');
    expect(cache.store('u', page).changed).toBe(true);
    expect(cache.lookup('u').state).toBe('fresh');
    now += 101;
    const stale = cache.lookup('u');
    expect(stale.state).toBe('stale');
    expect(stale.state === 'stale' && stale.entry.etag).toBe('"v1"');
    expect(cache.store('u', { ...page, etag: null }).changed).toBe(false);
    expect(cache.lookup('u').state).toBe('fresh');
    expect(cache.store('u', { ...page, body: 'changed' }).changed).toBe(true);
  });

  it('touch reopens the window and eviction bounds the size', () => {
    let now = 0;
    const cache = createPageCache({ now: () => now, freshnessMs: 10, maxEntries: 2 });
    const page = { status: 200, body: 'a', contentType: 'text/html' };
    cache.store('a', page);
    now = 11;
    expect(cache.touch('a')?.freshUntil).toBe(21);
    expect(cache.touch('missing')).toBeNull();
    cache.store('b', page);
    cache.store('c', page);
    expect(cache.size()).toBe(2);
    expect(cache.lookup('a').state).toBe('miss');
  });
});
