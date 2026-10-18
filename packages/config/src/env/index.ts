// Typed env for every app and package (spike §3.2). The only module allowed to read `process.env`;
// later issues add keys to the schema instead of reading the environment directly.
import { createEnv as createT3Env, type StandardSchemaV1 } from '@t3-oss/env-core';

import { CLIENT_PREFIX, clientShape } from './client.ts';
import {
  envRegistry,
  serverSchema,
  serverShape,
  sharedShape,
  type RawEnv,
  type ServerEnv,
} from './schema.ts';
import { REDACTED } from './secret.ts';

export { clientEnv, createClientEnv, type ClientEnv } from './client.ts';
export { envRegistry, OVERRIDE_ACK, type ServerEnv } from './schema.ts';
export { isSecret, Secret } from './secret.ts';
export type { KeySpec } from './registry.ts';

/** One error listing every invalid key. Messages never include the supplied values. */
export class EnvValidationError extends Error {
  readonly keys: readonly string[];

  constructor(issues: readonly StandardSchemaV1.Issue[], runtimeEnv: RawEnv) {
    const lines = issues.map((issue) => {
      const key =
        issue.path?.map((p) => String(typeof p === 'object' ? p.key : p)).join('.') ?? '(root)';
      return { key, line: `  - ${key}: ${redactValues(issue.message, runtimeEnv)}` };
    });
    super(`Invalid environment variables:\n${lines.map((l) => l.line).join('\n')}`);
    this.name = 'EnvValidationError';
    this.keys = [...new Set(lines.map((l) => l.key))];
  }
}

/** Belt and braces: strip any supplied value that a validator message might echo back. */
function redactValues(message: string, runtimeEnv: RawEnv): string {
  let out = message;
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value === undefined || value.length < 4 || PUBLIC_VALUE_KEYS.has(key)) continue;
    out = out.split(value).join(REDACTED);
  }
  return out;
}

/** Enum, literal and boolean keys hold no sensitive data, so their values may appear in messages. */
const PUBLIC_VALUE_KEYS = new Set(
  envRegistry
    .filter((spec) => /^(enum|literal|boolean)\b/.test(spec.type))
    .map((spec) => spec.name),
);

function assertServer(): void {
  if ('window' in globalThis) {
    throw new Error(
      'Server env was imported in client code. Use `clientEnv` from `@causedeck/config/env/client`.',
    );
  }
}

/** Validate `runtimeEnv` (defaults to `process.env`) and return the typed server env. */
export function createEnv(runtimeEnv: RawEnv = process.env): ServerEnv {
  assertServer();
  // env-core deletes empty strings from the object it is given, so hand it a copy.
  const env = { ...runtimeEnv };
  return createT3Env({
    clientPrefix: CLIENT_PREFIX,
    server: serverShape,
    shared: sharedShape,
    client: clientShape,
    runtimeEnv: env,
    isServer: true,
    emptyStringAsUndefined: true,
    skipValidation: env.SKIP_ENV_VALIDATION === '1',
    createFinalSchema: () => serverSchema,
    onValidationError: (issues) => {
      throw new EnvValidationError(issues, env);
    },
  });
}

let cached: ServerEnv | undefined;

/** Lazily validated, cached server env. Throws `EnvValidationError` on the first call if invalid. */
export function serverEnv(): ServerEnv {
  assertServer();
  return (cached ??= createEnv());
}

/** Test hook: drop the cached server env. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isCI(): boolean {
  const ci = process.env.CI;
  return ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
}
