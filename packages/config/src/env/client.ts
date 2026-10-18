// Client-safe env: only `NEXT_PUBLIC_*` keys. This module must never import server schema or
// `Secret` code, so it can be bundled into browser code.
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { applyDefaults, type KeyMetaRecord } from './registry.ts';

export const CLIENT_PREFIX = 'NEXT_PUBLIC_';

export const clientKeys = {
  NEXT_PUBLIC_APP_URL: {
    domain: 'client',
    type: 'url',
    description: 'Public URL of the web app, exposed to the browser.',
    devDefault: 'http://localhost:3000',
    requiredWhen: 'NODE_ENV=production',
    ownerIssue: 10,
  },
} satisfies KeyMetaRecord;

export const clientShape = {
  NEXT_PUBLIC_APP_URL: z.url().describe(clientKeys.NEXT_PUBLIC_APP_URL.description),
};

// Compile-time guard: every client key carries the public prefix.
type NonPublicKeys = Exclude<keyof typeof clientShape, `${typeof CLIENT_PREFIX}${string}`>;
export const CLIENT_KEYS_ARE_PUBLIC: [NonPublicKeys] extends [never] ? true : never = true;

export type ClientEnv = {
  readonly [K in keyof typeof clientShape]: z.output<(typeof clientShape)[K]>;
};

/** Literal `process.env.NEXT_PUBLIC_*` reads so bundlers can inline them. */
function readClientRuntimeEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
}

export function createClientEnv(
  runtimeEnv: Record<string, string | undefined> = readClientRuntimeEnv(),
): ClientEnv {
  for (const key of Object.keys(clientShape)) {
    if (!key.startsWith(CLIENT_PREFIX))
      throw new Error(`Client env key ${key} lacks ${CLIENT_PREFIX}`);
  }
  const withDefaults = applyDefaults(clientKeys, runtimeEnv);
  const env = createEnv({
    clientPrefix: CLIENT_PREFIX,
    client: clientShape,
    runtimeEnv: withDefaults,
    emptyStringAsUndefined: true,
    skipValidation: runtimeEnv.SKIP_ENV_VALIDATION === '1',
    onValidationError: (issues) => {
      const keys = issues.map((issue) => issue.path?.map(String).join('.') ?? '(root)');
      throw new Error(`Invalid client environment variables: ${keys.join(', ')}`);
    },
  });
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(clientShape)) out[key] = env[key as keyof ClientEnv];
  return Object.freeze(out) as ClientEnv;
}

let cached: ClientEnv | undefined;

/** Lazily validated client env; only `NEXT_PUBLIC_*` keys are exposed. */
export const clientEnv: ClientEnv = new Proxy({} as ClientEnv, {
  get: (_target, prop): unknown => Reflect.get((cached ??= createClientEnv()), prop) as unknown,
  has: (_target, prop) => Reflect.has((cached ??= createClientEnv()), prop),
  ownKeys: () => Reflect.ownKeys((cached ??= createClientEnv())),
  getOwnPropertyDescriptor: (_target, prop) => {
    const descriptor = Reflect.getOwnPropertyDescriptor((cached ??= createClientEnv()), prop);
    return descriptor && { ...descriptor, configurable: true };
  },
});

/** Test hook: drop the cached client env. */
export function resetClientEnvCache(): void {
  cached = undefined;
}
