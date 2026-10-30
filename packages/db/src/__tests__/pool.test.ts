import { Secret } from '@causedeck/config/env';
import { describe, expect, it } from 'vitest';

import { createDb } from '../client.ts';
import {
  authPoolEnabled,
  DEFAULT_AUTH_POOL_MAX,
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_POOL_MAX,
  resolvePool,
} from '../pool.ts';

describe('resolvePool', () => {
  it('defaults: 10 app connections, 1 owner, a 5 s connect timeout', () => {
    expect(resolvePool({ role: 'app' })).toEqual({
      max: 10,
      connectTimeout: 5,
      applicationName: 'causedeck-app',
    });
    expect(resolvePool({ role: 'owner' }).max).toBe(1);
    expect(DEFAULT_POOL_MAX).toEqual({ app: 10, owner: 1 });
    expect(DEFAULT_CONNECT_TIMEOUT_SECONDS).toBe(5);
  });

  it('takes the sizes from the env', () => {
    const env = { DB_POOL_MAX: 25, DB_AUTH_POOL_MAX: 6, DB_CONNECT_TIMEOUT_SECONDS: 8 };
    expect(resolvePool({ role: 'app', env })).toMatchObject({ max: 25, connectTimeout: 8 });
    expect(resolvePool({ role: 'app', purpose: 'auth', env })).toMatchObject({
      max: 6,
      connectTimeout: 8,
      applicationName: 'causedeck-app-auth',
    });
  });

  it('keeps the owner pool at 1 whatever DB_POOL_MAX says, but honours the connect timeout', () => {
    const env = { DB_POOL_MAX: 40, DB_CONNECT_TIMEOUT_SECONDS: 12 };
    expect(resolvePool({ role: 'owner', env })).toMatchObject({ max: 1, connectTimeout: 12 });
  });

  it('gives the auth pool its own small default', () => {
    expect(resolvePool({ role: 'app', purpose: 'auth' }).max).toBe(DEFAULT_AUTH_POOL_MAX);
    expect(DEFAULT_AUTH_POOL_MAX).toBeLessThan(DEFAULT_POOL_MAX.app);
  });

  it('lets explicit options beat the env', () => {
    const env = { DB_POOL_MAX: 25, DB_CONNECT_TIMEOUT_SECONDS: 8 };
    expect(resolvePool({ role: 'app', env, max: 2, connectTimeout: 1 })).toMatchObject({
      max: 2,
      connectTimeout: 1,
    });
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a pool size of %s', (max) => {
    expect(() => resolvePool({ role: 'app', max })).toThrow(RangeError);
  });

  it('rejects a connect timeout below 1 s', () => {
    expect(() => resolvePool({ role: 'app', connectTimeout: 0 })).toThrow(RangeError);
  });
});

describe('authPoolEnabled', () => {
  it('is on by default and off when DB_AUTH_POOL_MAX is 0', () => {
    expect(authPoolEnabled({})).toBe(true);
    expect(authPoolEnabled({ DB_AUTH_POOL_MAX: 3 })).toBe(true);
    expect(authPoolEnabled({ DB_AUTH_POOL_MAX: 0 })).toBe(false);
  });
});

describe('createDb pool options', () => {
  const url = new Secret('postgres://u:p@localhost:5432/db');
  const options = (db: ReturnType<typeof createDb>) => db.$client.options;

  it('hands the size, connect timeout and application name to postgres-js', async () => {
    const db = createDb({
      url,
      role: 'app',
      purpose: 'auth',
      env: { DB_AUTH_POOL_MAX: 4, DB_CONNECT_TIMEOUT_SECONDS: 7 },
    });
    try {
      expect(options(db).max).toBe(4);
      expect(options(db).connect_timeout).toBe(7);
      expect(options(db).connection.application_name).toBe('causedeck-app-auth');
    } finally {
      await db.$client.end();
    }
  });

  it('uses the 5 s default instead of the 30 s postgres-js default', async () => {
    const db = createDb({ url, role: 'app' });
    try {
      expect(options(db).connect_timeout).toBe(5);
      expect(options(db).max).toBe(10);
    } finally {
      await db.$client.end();
    }
  });
});
