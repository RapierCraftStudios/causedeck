// A kill switch forces a flag off from the env alone, without any database access (#22).
import { createEnv, resetEnvCache } from '@causedeck/config/env';
import type { Queryable } from '@causedeck/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlagCache } from '../cache.ts';
import { evaluateAll, isEnabled, type FlagRows } from '../evaluate.ts';
import { FlagOffError, requireFlag } from '../server.ts';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';

/** A database that fails the test if anything touches it. */
const noDb = new Proxy({} as Queryable, {
  get: (_t, prop) => {
    throw new Error(`database accessed (${String(prop)})`);
  },
});

/** Rows saying invoices are on, globally and for the workspace, with legal acks. */
const dbSaysOn: FlagRows = {
  global: { 'invoices.enabled': { enabled: true, legalAckBy: WORKSPACE } },
  workspace: { 'invoices.enabled': { enabled: true, legalAckBy: WORKSPACE } },
};

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('kill switches', () => {
  it('KILL_INVOICES_ENABLED=1 turns invoices off without touching the database', async () => {
    const { killSwitches } = createEnv({ NODE_ENV: 'test', KILL_INVOICES_ENABLED: '1' });
    expect(killSwitches.KILL_INVOICES_ENABLED).toBe(true);
    const deps = { db: noDb, killSwitches, cache: null };
    expect(await isEnabled('invoices.enabled', { workspaceId: WORKSPACE }, deps)).toBe(false);
    await expect(requireFlag('invoices.enabled', { workspaceId: WORKSPACE }, deps)).rejects.toThrow(
      FlagOffError,
    );
  });

  it('wins over database rows that say on', async () => {
    const cache = new FlagCache<FlagRows>();
    cache.set(WORKSPACE.toLowerCase(), dbSaysOn);
    const ctx = { workspaceId: WORKSPACE };
    expect(await isEnabled('invoices.enabled', ctx, { db: noDb, killSwitches: {}, cache })).toBe(
      true,
    );
    const killed = { KILL_INVOICES_ENABLED: true };
    expect(
      await isEnabled('invoices.enabled', ctx, { db: noDb, killSwitches: killed, cache }),
    ).toBe(false);
    expect(
      (await evaluateAll(ctx, { db: noDb, killSwitches: killed, cache }))['invoices.enabled'],
    ).toBe(false);
  });

  it('reads the process env by default', async () => {
    vi.stubEnv('KILL_INVOICES_ENABLED', '1');
    resetEnvCache();
    expect(
      await isEnabled('invoices.enabled', { workspaceId: WORKSPACE }, { db: noDb, cache: null }),
    ).toBe(false);
  });
});
