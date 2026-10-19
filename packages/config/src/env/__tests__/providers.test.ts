import { describe, expect, it } from 'vitest';

import { createEnv, EnvValidationError } from '../index.ts';
import { envError, productionEnv } from './helpers.ts';

describe('provider switches', () => {
  it('EMAIL_PROVIDER=ses without SES keys fails once, naming every missing key', () => {
    const error = envError({ NODE_ENV: 'test', EMAIL_PROVIDER: 'ses' });

    expect(error).toBeInstanceOf(EnvValidationError);
    expect((error as EnvValidationError).keys).toEqual([
      'SES_REGION',
      'SES_ACCESS_KEY_ID',
      'SES_SECRET_ACCESS_KEY',
    ]);
    expect(error.message.split('\n')[0]).toBe('Invalid environment variables:');
  });

  it('EMAIL_PROVIDER=ses rejects a SES_REGION outside India (#195)', () => {
    const ses = {
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'ses',
      SES_ACCESS_KEY_ID: 'id',
      SES_SECRET_ACCESS_KEY: 'secret',
    };
    const error = envError({ ...ses, SES_REGION: 'us-east-1' });
    expect((error as EnvValidationError).keys).toEqual(['SES_REGION']);
    expect(error.message).toContain('SES_REGION: must be an India region');
    expect(createEnv({ ...ses, SES_REGION: 'ap-south-1' }).EMAIL_PROVIDER).toBe('ses');
    expect(createEnv({ ...ses, SES_REGION: 'ap-south-2' }).EMAIL_PROVIDER).toBe('ses');
  });

  it('never prints supplied values in the error', () => {
    const error = envError({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'ses',
      SES_ACCESS_KEY_ID: 'AKIA-VISIBLE-ACCESS-KEY',
      BETTER_AUTH_SECRET: 'too-short-but-secret',
    });

    expect((error as EnvValidationError).keys).toEqual([
      'BETTER_AUTH_SECRET',
      'SES_REGION',
      'SES_SECRET_ACCESS_KEY',
    ]);
    expect(error.message).not.toContain('AKIA-VISIBLE-ACCESS-KEY');
    expect(error.message).not.toContain('too-short-but-secret');
  });

  it('aggregates issues from several providers into one error', () => {
    const error = envError({
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'not a url',
      AI_PROVIDER: 'sarvam',
      BILLING_PROVIDER: 'razorpay',
      AUTH_GOOGLE_ENABLED: 'true',
      SENTRY_ENABLED: 'true',
    });

    expect((error as EnvValidationError).keys).toEqual([
      'SMTP_URL',
      'SARVAM_API_KEY',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'SENTRY_DSN',
    ]);
  });

  it('rejects unknown provider values', () => {
    const error = envError({ NODE_ENV: 'test', EMAIL_PROVIDER: 'postmark' });

    expect((error as EnvValidationError).keys).toEqual(['EMAIL_PROVIDER']);
  });

  it('validates credentials only for the selected provider', () => {
    const env = createEnv({ NODE_ENV: 'test', EMAIL_PROVIDER: 'console', SES_REGION: '' });

    expect(env.EMAIL_PROVIDER).toBe('console');
    expect('SES_REGION' in env).toBe(false);
  });

  it.each([
    [
      'EMAIL_PROVIDER=ses',
      {
        EMAIL_PROVIDER: 'ses',
        SES_REGION: 'ap-south-1',
        SES_ACCESS_KEY_ID: 'id',
        SES_SECRET_ACCESS_KEY: 'secret',
      },
    ],
    [
      'EMAIL_PROVIDER=smtp',
      { EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtps://user:pass@smtp.example.in:465' },
    ],
    ['AI_PROVIDER=sarvam', { AI_PROVIDER: 'sarvam', SARVAM_API_KEY: 'key' }],
    [
      'STORAGE_PROVIDER=s3',
      { STORAGE_PROVIDER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's' },
    ],
    [
      'BILLING_PROVIDER=razorpay',
      {
        BILLING_PROVIDER: 'razorpay',
        RAZORPAY_KEY_ID: 'k',
        RAZORPAY_SECRET: 's',
        RAZORPAY_WEBHOOK_SECRET: 'w',
      },
    ],
    [
      'AUTH_GOOGLE_ENABLED=true',
      { AUTH_GOOGLE_ENABLED: 'true', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' },
    ],
    ['SENTRY_ENABLED=1', { SENTRY_ENABLED: '1', SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1' }],
  ])('accepts %s with its credentials', (_name, vars) => {
    expect(() => createEnv({ NODE_ENV: 'test', ...vars })).not.toThrow();
  });

  it('wraps provider credentials in Secret', () => {
    const env = createEnv({
      NODE_ENV: 'test',
      AI_PROVIDER: 'sarvam',
      SARVAM_API_KEY: 'sarvam-key',
    });

    expect(env.AI_PROVIDER === 'sarvam' && String(env.SARVAM_API_KEY)).toBe('[REDACTED]');
    expect(env.AI_PROVIDER === 'sarvam' && env.SARVAM_API_KEY.reveal()).toBe('sarvam-key');
  });

  it('STORAGE_PROVIDER=s3 selects ap-south-1 with no endpoint and Secret credentials (#21)', () => {
    const env = createEnv(productionEnv);

    expect(env.STORAGE_PROVIDER).toBe('s3');
    expect(env.S3_REGION).toBe('ap-south-1');
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(String(env.S3_ACCESS_KEY)).toBe('[REDACTED]');
    expect(env.S3_ACCESS_KEY.reveal()).toBe(productionEnv.S3_ACCESS_KEY);
  });
});
