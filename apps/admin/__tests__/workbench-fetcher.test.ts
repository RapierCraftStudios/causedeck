// The workbench fetch is dark (#598): on only while the global flag row is on and the kill switch
// is unset; the provider is the mock until ALTERLAB_API_KEY is set.
import type * as Flags from '@causedeck/flags';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { killSwitches: {}, ALTERLAB_API_KEY: undefined },
  rows: new Array<{ key: string; enabled: boolean; legalAckBy: string | null }>(),
}));

vi.mock('../lib/env.ts', () => ({ serverEnv: () => mocks.env }));
vi.mock('@causedeck/core/sources', () => ({ policyFor: vi.fn(), createFetchLogSink: vi.fn() }));
vi.mock('@causedeck/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof Flags>()),
  listGlobalFlagRows: () => Promise.resolve(mocks.rows),
}));

const { workbenchFetchEnabled, workbenchProvider, WORKBENCH_FETCH_FLAG } =
  await import('../lib/workbench-fetcher.ts');

const DB = {} as never;
const USER = '0b6c1a52-8a3e-4d7f-9c1e-5f2a7b3c4d5e';

beforeEach(() => {
  mocks.env.killSwitches = {};
  mocks.env.ALTERLAB_API_KEY = undefined;
  mocks.rows = [];
});

describe('workbenchFetchEnabled', () => {
  it('is off by default and with no flag row', async () => {
    expect(await workbenchFetchEnabled(DB, USER)).toBe(false);
  });

  it('is on with the global row on, and the kill switch forces it off', async () => {
    mocks.rows = [{ key: WORKBENCH_FETCH_FLAG, enabled: true, legalAckBy: null }];
    expect(await workbenchFetchEnabled(DB, USER)).toBe(true);
    mocks.env.killSwitches = { KILL_ADAPTERS_WORKBENCH_FETCH: true };
    expect(await workbenchFetchEnabled(DB, USER)).toBe(false);
  });
});

describe('workbenchProvider', () => {
  it('is the offline mock without an AlterLab key', async () => {
    const response = await workbenchProvider().fetch({
      url: 'https://x.test/a',
      maxTier: 'http',
      maxCostDollars: 0,
      proxyCountry: 'IN',
      failFast: true,
    });
    expect(response.costDollars).toBe(0);
    expect(response.body).toContain('mock fixture for https://x.test/a');
  });
});
