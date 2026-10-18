import { inspect } from 'node:util';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createEnv, isSecret, Secret } from '../index.ts';
import { envError, productionEnv } from './helpers.ts';

const RAW = 'super-secret-value-123';

describe('Secret', () => {
  const value = new Secret(RAW);

  it('redacts JSON.stringify', () => {
    expect(JSON.stringify(value)).toBe('"[REDACTED]"');
    expect(JSON.stringify({ nested: { value } })).not.toContain(RAW);
  });

  it('redacts String() and template literals', () => {
    expect(String(value)).toBe('[REDACTED]');
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- the point of the test
    expect(`${value}`).toBe('[REDACTED]');
  });

  it('redacts util.inspect, including when nested', () => {
    expect(inspect(value)).toBe('[REDACTED]');
    expect(inspect({ value }, { depth: 5, showHidden: true })).not.toContain(RAW);
  });

  it('redacts pino serialisation', () => {
    const lines: string[] = [];
    const logger = pino({}, { write: (line: string) => lines.push(line) });

    logger.info({ secret: value, config: { value } }, 'boot');

    expect(lines.join('')).toContain('[REDACTED]');
    expect(lines.join('')).not.toContain(RAW);
  });

  it('reveal() returns the raw value', () => {
    expect(value.reveal()).toBe(RAW);
    expect(isSecret(value)).toBe(true);
    expect(isSecret(RAW)).toBe(false);
  });

  it('exposes no enumerable fields', () => {
    expect(Object.keys(value)).toEqual([]);
    expect(Object.isFrozen(value)).toBe(true);
  });
});

describe('env secrets', () => {
  it('serialising the whole env never leaks a credential', () => {
    const env = createEnv(productionEnv);
    const serialised = [JSON.stringify(env), inspect(env, { depth: 5 })].join('\n');

    for (const key of [
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'KEK_BASE64',
      'SES_SECRET_ACCESS_KEY',
      'SARVAM_API_KEY',
      'S3_SECRET_KEY',
      'RAZORPAY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
    ] as const) {
      expect(serialised).not.toContain(productionEnv[key]);
    }
  });

  it('validation errors never include supplied secret values', () => {
    const error = envError({
      ...productionEnv,
      KEK_BASE64: 'not-base64-but-a-secret!!',
      DATABASE_URL: 'mysql://user:db-secret@host/db',
    });

    expect(error.message).toContain('KEK_BASE64');
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).not.toContain('not-base64-but-a-secret!!');
    expect(error.message).not.toContain('db-secret');
  });
});
