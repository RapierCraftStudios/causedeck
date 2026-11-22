// `resolverFromEnv` (#1136): `CITATION_RESOLVER` picks the in-process corpus by default, the offline
// mock for CI, or Indian Kanoon with its token. No database: the resolvers are only constructed.
import { resetEnvCache } from '@causedeck/config/env';
import type { Queryable } from '@causedeck/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolverFromEnv } from './drafting-citations-check.ts';

const db = {} as Queryable;

function select(env: Record<string, string | undefined>) {
  vi.stubEnv('CITATION_RESOLVER', env.CITATION_RESOLVER);
  vi.stubEnv('INDIAN_KANOON_API_TOKEN', env.INDIAN_KANOON_API_TOKEN);
  resetEnvCache();
}

describe('resolverFromEnv', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('defaults to the in-process corpus resolver', () => {
    select({});
    const resolver = resolverFromEnv(db);
    expect(resolver.name).toBe('corpus');
    expect(resolver.external).toBe(false);
  });

  it('keeps the offline mock for CI', () => {
    select({ CITATION_RESOLVER: 'mock' });
    expect(resolverFromEnv(db).name).toBe('mock');
  });

  it('keeps Indian Kanoon, which needs its token', () => {
    select({ CITATION_RESOLVER: 'indian-kanoon', INDIAN_KANOON_API_TOKEN: 'ik-token-value' });
    const resolver = resolverFromEnv(db);
    expect(resolver.name).toBe('indian-kanoon');
    expect(resolver.external).toBe(true);
  });
});
