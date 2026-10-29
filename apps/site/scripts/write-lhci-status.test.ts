import { describe, expect, it } from 'vitest';

import { DEV_STATUS_VERIFY_KEY } from '../lib/env.ts';
import { parseStatusSnapshot } from '../lib/status/model.ts';
import { verifySnapshot } from '../lib/status/verify.ts';
import { lhciSnapshot } from './write-lhci-status.ts';

describe('lhciSnapshot', () => {
  const now = new Date('2026-10-29T10:00:00.000Z');

  it('verifies under the build key and is operational', async () => {
    const snapshot = await verifySnapshot(
      lhciSnapshot(now, DEV_STATUS_VERIFY_KEY),
      DEV_STATUS_VERIFY_KEY,
    );
    expect(snapshot?.overall).toBe('operational');
    expect(snapshot?.generatedAt).toBe(now.toISOString());
  });

  it('does not verify under another key', async () => {
    expect(await verifySnapshot(lhciSnapshot(now, 'other-key'), DEV_STATUS_VERIFY_KEY)).toBeNull();
  });

  it('drops unknown keys and rejects a malformed shape', () => {
    const good = lhciSnapshot(now, DEV_STATUS_VERIFY_KEY);
    expect(parseStatusSnapshot({ ...good, extra: 1 })).not.toHaveProperty('extra');
    expect(parseStatusSnapshot({ ...good, overall: 'fine' })).toBeNull();
    expect(parseStatusSnapshot({ ...good, generatedAt: 'yesterday' })).toBeNull();
    expect(
      parseStatusSnapshot({ ...good, components: [{ id: 'x', name: 'x', status: 'down' }] }),
    ).toBeNull();
    expect(parseStatusSnapshot(null)).toBeNull();
  });
});
