import { createEnv, isSecret, Secret } from '@causedeck/config/env';
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
