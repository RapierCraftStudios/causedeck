import { inspect } from 'node:util';

import type { z } from 'zod';

export const REDACTED = '[REDACTED]';

declare const secretBrand: unique symbol;

/**
 * Wraps a credential so it cannot leak through logging or serialisation. Every string and JSON
 * conversion (including `util.inspect` and pino) yields `[REDACTED]`; call `reveal()` at the
 * point of use.
 */
export class Secret<T = string> {
  declare readonly [secretBrand]: true;
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
    Object.freeze(this);
  }

  reveal(): T {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

export function isSecret(value: unknown): value is Secret<unknown> {
  return value instanceof Secret;
}

/** Validate a string with `schema`, then wrap it in `Secret`. */
export function secret<S extends z.ZodType<string, string>>(schema: S) {
  return schema.transform((value) => new Secret(value));
}
