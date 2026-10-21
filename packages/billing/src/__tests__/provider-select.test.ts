import { createEnv, EnvValidationError, isSecret, Secret } from '@causedeck/config/env';
import { describe, expect, it } from 'vitest';

import { createBillingProvider, getRazorpayWebhookSecret } from '../provider';

const KEY_SECRET = 'rzp-select-key-secret';
const WEBHOOK_SECRET = 'rzp-select-webhook-secret';

describe('createBillingProvider', () => {
  it('selects the mock when BILLING_PROVIDER=mock and no Razorpay keys are set', () => {
    expect(createBillingProvider({ BILLING_PROVIDER: 'mock' }).name).toBe('mock');
  });

  it('boots with the mock from an env that has no billing keys', () => {
    const env = createEnv({ NODE_ENV: 'test' });
    expect(env.BILLING_PROVIDER).toBe('mock');
    expect(createBillingProvider(env).name).toBe('mock');
    expect(getRazorpayWebhookSecret(env)).toBeNull();
  });

  it('selects Razorpay with Secret-wrapped keys from the env', () => {
    const env = createEnv({
      NODE_ENV: 'test',
      BILLING_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_FIXTURE',
      RAZORPAY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    const provider = createBillingProvider(env);
    expect(provider.name).toBe('razorpay');
    expect(JSON.stringify(provider)).not.toContain(KEY_SECRET);
  });

  it('keeps the webhook secret wrapped', () => {
    const secret = getRazorpayWebhookSecret({
      BILLING_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_FIXTURE',
      RAZORPAY_SECRET: new Secret(KEY_SECRET),
      RAZORPAY_WEBHOOK_SECRET: new Secret(WEBHOOK_SECRET),
    });
    expect(isSecret(secret)).toBe(true);
    expect(String(secret)).toBe('[REDACTED]');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
    expect(secret?.reveal()).toBe(WEBHOOK_SECRET);
  });
});

/** A production env with real providers everywhere except billing, which is left to the test. */
const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://app:prod-db-password@db.internal:5432/causedeck',
  APP_URL: 'https://app.causedeck.in',
  API_URL: 'https://api.causedeck.in',
  NEXT_PUBLIC_APP_URL: 'https://app.causedeck.in',
  BETTER_AUTH_SECRET: 'prod-better-auth-secret-0123456789abcdef',
  KEK_BASE64: Buffer.alloc(32, 7).toString('base64'),
  EMAIL_PROVIDER: 'ses',
  SES_REGION: 'ap-south-1',
  SES_ACCESS_KEY_ID: 'AKIAPRODSESKEY',
  SES_SECRET_ACCESS_KEY: 'prod-ses-secret-value',
  AI_PROVIDER: 'sarvam',
  SARVAM_API_KEY: 'prod-sarvam-api-key',
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'causedeck-prod',
  S3_ACCESS_KEY: 'AKIAPRODS3',
  S3_SECRET_KEY: 'prod-s3-secret-value',
} as const;

function bootError(env: Record<string, string>): EnvValidationError {
  try {
    createEnv(env);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('expected the production boot to fail');
}

describe('billing boot guard (#4, #206)', () => {
  it('refuses a production boot on the mock without the explicit override', () => {
    const error = bootError({ ...PRODUCTION, BILLING_PROVIDER: 'mock' });
    expect(error.keys).toEqual(['BILLING_PROVIDER']);
    expect(error.message).toContain('ALLOW_MOCK_PROVIDERS=true');

    // No keys at all defaults to the mock, which production refuses the same way.
    expect(bootError({ ...PRODUCTION }).keys).toEqual(['BILLING_PROVIDER']);
  });

  it('boots production on the mock only with ALLOW_MOCK_PROVIDERS=true', () => {
    const env = createEnv({ ...PRODUCTION, ALLOW_MOCK_PROVIDERS: 'true' });
    expect(env.BILLING_PROVIDER).toBe('mock');
    expect(createBillingProvider(env).name).toBe('mock');
  });

  it('never exposes the Razorpay secrets when the env or a boot error is serialised', () => {
    const env = createEnv({
      ...PRODUCTION,
      BILLING_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_live_FIXTURE',
      RAZORPAY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    expect(env.BILLING_PROVIDER).toBe('razorpay');
    if (env.BILLING_PROVIDER !== 'razorpay') return;
    expect(isSecret(env.RAZORPAY_SECRET)).toBe(true);
    expect(isSecret(env.RAZORPAY_WEBHOOK_SECRET)).toBe(true);
    const serialised = `${JSON.stringify(env)} ${String(env.RAZORPAY_SECRET)}`;
    expect(serialised).not.toContain(KEY_SECRET);
    expect(serialised).not.toContain(WEBHOOK_SECRET);

    // A partial Razorpay config fails without echoing the secret it did get.
    const error = bootError({
      ...PRODUCTION,
      BILLING_PROVIDER: 'razorpay',
      RAZORPAY_SECRET: KEY_SECRET,
    });
    expect(error.keys).toEqual(
      expect.arrayContaining(['RAZORPAY_KEY_ID', 'RAZORPAY_WEBHOOK_SECRET']),
    );
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(KEY_SECRET);
  });
});
