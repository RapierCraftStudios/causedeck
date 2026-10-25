import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEnv, EnvValidationError, resetEnvCache, serverEnv } from '../index.ts';
import { DEV_BETTER_AUTH_SECRET, DEV_KEK_BASE64, DEV_STATUS_SIGNING_KEY } from '../schema.ts';
import { envError, productionEnv } from './helpers.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('empty environment', () => {
  it('boots with only NODE_ENV=test and selects mock/console providers', () => {
    const env = createEnv({ NODE_ENV: 'test' });

    expect(env.NODE_ENV).toBe('test');
    expect(env.EMAIL_PROVIDER).toBe('console');
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.BILLING_PROVIDER).toBe('mock');
    expect(env.STORAGE_PROVIDER).toBe('minio');
    expect(env.AUTH_GOOGLE_ENABLED).toBe(false);
    expect(env.SENTRY_ENABLED).toBe(false);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('serverEnv() reads process.env lazily and caches the result', () => {
    for (const key of Object.keys(process.env)) vi.stubEnv(key, undefined);
    vi.stubEnv('NODE_ENV', 'test');

    const first = serverEnv();
    vi.stubEnv('LOG_LEVEL', 'debug');

    expect(serverEnv()).toBe(first);
    expect(first.LOG_LEVEL).toBe('info');
    resetEnvCache();
    expect(serverEnv().LOG_LEVEL).toBe('debug');
  });

  it('treats empty strings as unset', () => {
    expect(createEnv({ NODE_ENV: 'test', EMAIL_PROVIDER: '' }).EMAIL_PROVIDER).toBe('console');
  });
});

describe('dev-only defaults', () => {
  it('apply local Postgres, MinIO and Mailpit URLs outside production', () => {
    const env = createEnv({ NODE_ENV: 'development', EMAIL_PROVIDER: 'smtp' });

    expect(env.DATABASE_URL.reveal()).toBe(
      'postgres://causedeck_app:causedeck_app@localhost:5432/causedeck',
    );
    expect(env.DATABASE_URL_OWNER?.reveal()).toBe(
      'postgres://causedeck_owner:causedeck_owner@localhost:5432/causedeck',
    );
    expect(env.STORAGE_PROVIDER === 'minio' && env.S3_ENDPOINT).toBe('http://localhost:9000');
    expect(env.S3_BUCKET).toBe('causedeck-dev');
    expect(env.S3_ACCESS_KEY.reveal()).toBe('minioadmin');
    expect(env.S3_SECRET_KEY.reveal()).toBe('minioadmin');
    expect(env.EMAIL_PROVIDER === 'smtp' && env.SMTP_URL.reveal()).toBe('smtp://localhost:1025');
    expect(env.APP_URL).toBe('http://localhost:3000');
  });

  it('do not apply in production', () => {
    const error = envError({ NODE_ENV: 'production', ALLOW_MOCK_PROVIDERS: 'true' });

    for (const key of ['DATABASE_URL', 'APP_URL', 'API_URL', 'S3_ENDPOINT', 'S3_BUCKET']) {
      expect(error.message).toContain(`${key}: is required`);
    }
  });
});

describe('production', () => {
  it('accepts a complete production env', () => {
    const env = createEnv(productionEnv);

    expect(env.NODE_ENV).toBe('production');
    expect(env.KEK_BASE64.reveal()).toBe(productionEnv.KEK_BASE64);
  });

  it('requires DATABASE_URL, BETTER_AUTH_SECRET and KEK_BASE64', () => {
    const error = envError({
      ...productionEnv,
      DATABASE_URL: undefined,
      BETTER_AUTH_SECRET: undefined,
      KEK_BASE64: undefined,
    });

    expect(error).toBeInstanceOf(EnvValidationError);
    expect((error as EnvValidationError).keys).toEqual([
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'KEK_BASE64',
    ]);
  });

  it('defaults STATUS_SIGNING_KEY in development and rejects the placeholder in production (#769)', () => {
    expect(createEnv({ NODE_ENV: 'development' }).STATUS_SIGNING_KEY.reveal()).toBe(
      DEV_STATUS_SIGNING_KEY,
    );
    expect(
      envError({ ...productionEnv, STATUS_SIGNING_KEY: DEV_STATUS_SIGNING_KEY }).message,
    ).toContain('STATUS_SIGNING_KEY: must not use the development placeholder');
    expect(envError({ ...productionEnv, STATUS_SIGNING_KEY: 'short' }).message).toContain(
      'STATUS_SIGNING_KEY: must be at least 32 characters',
    );
  });

  it('rejects a BETTER_AUTH_SECRET shorter than 32 characters', () => {
    const error = envError({ ...productionEnv, BETTER_AUTH_SECRET: 'x'.repeat(31) });

    expect(error.message).toContain('BETTER_AUTH_SECRET: must be at least 32 characters');
  });

  it('rejects a KEK_BASE64 that is not exactly 32 bytes', () => {
    const error = envError({ ...productionEnv, KEK_BASE64: Buffer.alloc(16).toString('base64') });

    expect(error.message).toContain('KEK_BASE64: must decode to exactly 32 bytes');
  });

  it('rejects the development placeholders', () => {
    const error = envError({
      ...productionEnv,
      BETTER_AUTH_SECRET: DEV_BETTER_AUTH_SECRET,
      KEK_BASE64: DEV_KEK_BASE64,
    });

    expect((error as EnvValidationError).keys).toEqual(['BETTER_AUTH_SECRET', 'KEK_BASE64']);
  });

  it('rejects mock providers unless ALLOW_MOCK_PROVIDERS=true', () => {
    const mocks = {
      ...productionEnv,
      EMAIL_PROVIDER: 'console',
      AI_PROVIDER: 'mock',
      BILLING_PROVIDER: 'mock',
    };

    expect((envError(mocks) as EnvValidationError).keys).toEqual([
      'EMAIL_PROVIDER',
      'AI_PROVIDER',
      'BILLING_PROVIDER',
    ]);
    expect(envError({ ...mocks, ALLOW_MOCK_PROVIDERS: 'false' }).message).toContain(
      'mock provider',
    );
    expect(createEnv({ ...mocks, ALLOW_MOCK_PROVIDERS: 'true' }).AI_PROVIDER).toBe('mock');
  });

  it('requires VAPID keys together', () => {
    const error = envError({ ...productionEnv, VAPID_PUBLIC_KEY: 'public-key' });

    expect((error as EnvValidationError).keys).toEqual(['VAPID_PRIVATE_KEY']);
  });

  it('requires the WhatsApp phone number id and access token together', () => {
    const error = envError({ ...productionEnv, WHATSAPP_PHONE_NUMBER_ID: '123' });

    expect((error as EnvValidationError).keys).toEqual(['WHATSAPP_ACCESS_TOKEN']);
  });
});

describe('India-only AI guardrail', () => {
  it('defaults AI_INDIA_ONLY to true', () => {
    expect(createEnv({ NODE_ENV: 'test' }).AI_INDIA_ONLY).toBe(true);
  });

  it('requires AI_INDIA_ONLY_OVERRIDE_ACK=I_UNDERSTAND to disable it in production', () => {
    const error = envError({ ...productionEnv, AI_INDIA_ONLY: 'false' });

    expect((error as EnvValidationError).keys).toEqual(['AI_INDIA_ONLY_OVERRIDE_ACK']);
    expect(
      envError({ ...productionEnv, AI_INDIA_ONLY: 'false', AI_INDIA_ONLY_OVERRIDE_ACK: 'yes' })
        .message,
    ).toContain('AI_INDIA_ONLY_OVERRIDE_ACK');
    const env = createEnv({
      ...productionEnv,
      AI_INDIA_ONLY: 'false',
      AI_INDIA_ONLY_OVERRIDE_ACK: 'I_UNDERSTAND',
    });
    expect(env.AI_INDIA_ONLY).toBe(false);
  });

  it('allows AI_INDIA_ONLY=false outside production without the ACK', () => {
    expect(createEnv({ NODE_ENV: 'development', AI_INDIA_ONLY: 'false' }).AI_INDIA_ONLY).toBe(
      false,
    );
  });

  it('keeps Bedrock in an India region while AI_INDIA_ONLY=true', () => {
    const bedrock = {
      NODE_ENV: 'test',
      AI_PROVIDER: 'bedrock',
      BEDROCK_ACCESS_KEY_ID: 'AKIABEDROCK',
      BEDROCK_SECRET_ACCESS_KEY: 'bedrock-secret',
      BEDROCK_MODEL_ID: 'model',
    };

    expect(createEnv(bedrock).AI_PROVIDER).toBe('bedrock');
    expect(envError({ ...bedrock, BEDROCK_REGION: 'us-east-1' }).message).toContain(
      'BEDROCK_REGION: must be an India region',
    );
  });
});

describe('data residency', () => {
  it('defaults AWS_REGION to ap-south-1 and DATA_REGION to in', () => {
    const env = createEnv({ NODE_ENV: 'test' });

    expect(env.AWS_REGION).toBe('ap-south-1');
    expect(env.DATA_REGION).toBe('in');
  });

  it('accepts the Hyderabad region', () => {
    expect(createEnv({ NODE_ENV: 'test', AWS_REGION: 'ap-south-2' }).AWS_REGION).toBe('ap-south-2');
  });

  it('rejects non-India regions unless overridden', () => {
    const error = envError({ NODE_ENV: 'test', AWS_REGION: 'us-east-1', DATA_REGION: 'us' });

    expect((error as EnvValidationError).keys).toEqual(['AWS_REGION', 'DATA_REGION']);
    const env = createEnv({
      NODE_ENV: 'test',
      AWS_REGION: 'us-east-1',
      DATA_REGION: 'us',
      AWS_REGION_OVERRIDE_ACK: 'I_UNDERSTAND',
    });
    expect(env.AWS_REGION).toBe('us-east-1');
  });

  it('rejects a non-India S3_REGION unless overridden (#21)', () => {
    const error = envError({ NODE_ENV: 'test', S3_REGION: 'us-east-1' });

    expect((error as EnvValidationError).keys).toEqual(['S3_REGION']);
    expect(error.message).toContain('AWS_REGION_OVERRIDE_ACK');
    const env = createEnv({
      NODE_ENV: 'test',
      S3_REGION: 'eu-west-1',
      AWS_REGION_OVERRIDE_ACK: 'I_UNDERSTAND',
    });
    expect(env.S3_REGION).toBe('eu-west-1');
    expect(createEnv({ NODE_ENV: 'test', S3_REGION: 'ap-south-2' }).S3_REGION).toBe('ap-south-2');
  });
});

describe('kill switches', () => {
  it('parses every KILL_* key as a boolean', () => {
    const env = createEnv({ NODE_ENV: 'test', KILL_AI: 'true', KILL_CAPTURE: 'false' });

    expect(env.killSwitches).toEqual({ KILL_AI: true, KILL_CAPTURE: false });
    expect(envError({ NODE_ENV: 'test', KILL_AI: 'maybe' }).message).toContain('KILL_AI');
  });
});

describe('SKIP_ENV_VALIDATION', () => {
  it('skips validation only when set to 1', () => {
    const invalid = { NODE_ENV: 'production', AWS_REGION: 'us-east-1' };

    expect(() => createEnv({ ...invalid, SKIP_ENV_VALIDATION: '1' })).not.toThrow();
    expect(envError({ ...invalid, SKIP_ENV_VALIDATION: 'true' }).message).toContain(
      'SKIP_ENV_VALIDATION',
    );
  });
});
