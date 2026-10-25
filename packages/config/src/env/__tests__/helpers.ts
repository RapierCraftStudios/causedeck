import { createEnv } from '../index.ts';

/** Strong values for every key production requires, with real providers selected. */
export const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://app:prod-db-password@db.internal:5432/causedeck',
  APP_URL: 'https://app.causedeck.in',
  API_URL: 'https://api.causedeck.in',
  NEXT_PUBLIC_APP_URL: 'https://app.causedeck.in',
  BETTER_AUTH_SECRET: 'prod-better-auth-secret-0123456789abcdef',
  STATUS_SIGNING_KEY: 'prod-status-signing-key-0123456789abcdef',
  KEK_BASE64: Buffer.alloc(32, 7).toString('base64'),
  EMAIL_PROVIDER: 'ses',
  SES_REGION: 'ap-south-1',
  SES_ACCESS_KEY_ID: 'AKIAPRODSESKEY',
  SES_SECRET_ACCESS_KEY: 'prod-ses-secret-value',
  AI_PROVIDER: 'sarvam',
  SARVAM_API_KEY: 'prod-sarvam-api-key',
  SARVAM_NO_TRAINING_CONFIRMED: 'true',
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'causedeck-prod',
  S3_ACCESS_KEY: 'AKIAPRODS3',
  S3_SECRET_KEY: 'prod-s3-secret-value',
  BILLING_PROVIDER: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_live_key',
  RAZORPAY_SECRET: 'prod-razorpay-secret',
  RAZORPAY_WEBHOOK_SECRET: 'prod-razorpay-webhook-secret',
} as const satisfies Record<string, string>;

/** Run `createEnv` and return the thrown error message (or fail when it does not throw). */
export function envError(env: Record<string, string | undefined>): Error {
  try {
    createEnv(env);
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('expected createEnv to throw');
}
