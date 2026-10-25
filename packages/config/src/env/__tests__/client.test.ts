import { afterEach, describe, expect, it } from 'vitest';

import { lintFixture, ruleIds } from '../../../test/eslint-helpers';
import {
  CLIENT_PREFIX,
  clientEnv,
  clientShape,
  createClientEnv,
  resetClientEnvCache,
} from '../client.ts';
import { createEnv, serverEnv } from '../index.ts';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  resetClientEnvCache();
});

describe('client env', () => {
  it('declares only NEXT_PUBLIC_* keys', () => {
    for (const key of Object.keys(clientShape)) expect(key.startsWith(CLIENT_PREFIX)).toBe(true);
  });

  it('exposes only NEXT_PUBLIC_* keys, even when server keys are present', () => {
    const env = createClientEnv({
      NODE_ENV: 'test',
      NEXT_PUBLIC_APP_URL: 'https://app.causedeck.in',
      DATABASE_URL: 'postgres://u:p@h/db',
      BETTER_AUTH_SECRET: 'x'.repeat(40),
    });

    expect(Object.keys(env)).toEqual(['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPPORT_WHATSAPP']);
    expect(env.NEXT_PUBLIC_APP_URL).toBe('https://app.causedeck.in');
  });

  it('applies the local default outside production and requires the key in production', () => {
    expect(createClientEnv({ NODE_ENV: 'test' }).NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(() => createClientEnv({ NODE_ENV: 'production' })).toThrow('NEXT_PUBLIC_APP_URL');
  });

  it('clientEnv validates lazily and lists only public keys', () => {
    expect(Object.keys(clientEnv).every((key) => key.startsWith(CLIENT_PREFIX))).toBe(true);
  });
});

describe('server env in client code', () => {
  it('throws at runtime when called in a browser', () => {
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });

    expect(() => serverEnv()).toThrow('Server env was imported in client code');
    expect(() => createEnv({ NODE_ENV: 'test' })).toThrow('Server env was imported in client code');
  });

  it.each([
    'apps/web/src/components/server-env.ts',
    'apps/web/src/page.client.ts',
    'packages/ui/src/server-env.ts',
  ])('fails lint when %s imports @causedeck/config/env', async (file) => {
    const result = await lintFixture('env', file);
    const messages = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');

    expect(messages.map((m) => m.message).join('\n')).toContain(
      'Server env must not reach client code',
    );
  });

  it('allows client modules to import @causedeck/config/env/client', async () => {
    const result = await lintFixture('env', 'apps/web/src/components/client-env.ts');

    expect(ruleIds(result)).not.toContain('no-restricted-imports');
  });
});

describe('no-process-env', () => {
  it('forbids process.env outside packages/config', async () => {
    const result = await lintFixture('env', 'packages/core/src/reads-process-env.ts');

    expect(ruleIds(result)).toContain('no-process-env');
  });

  it('allows process.env inside packages/config/src/env', async () => {
    const result = await lintFixture('env', 'packages/config/src/env/reads-process-env.ts');

    expect(ruleIds(result)).not.toContain('no-process-env');
  });
});
