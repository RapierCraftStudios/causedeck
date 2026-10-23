// Integration provider switches (spike §9). Every switch defaults to a mock or console provider
// so dev and CI boot without secrets; real credentials are required only on the selected branch.
import { z } from 'zod';

import type { KeyMetaRecord } from './registry.ts';
import { secret } from './secret.ts';

/** AWS regions in India: Mumbai and Hyderabad. */
export const INDIA_AWS_REGIONS = ['ap-south-1', 'ap-south-2'] as const;

const required = z.string().min(1);

export const providerKeys = {
  EMAIL_PROVIDER: {
    domain: 'email',
    type: 'enum(console|ses|smtp)',
    description: 'Email transport. `console` logs messages; `ses` and `smtp` send them.',
    default: 'console',
    requiredWhen: 'never (defaults to console)',
    ownerIssue: 23,
  },
  SES_REGION: {
    domain: 'email',
    type: 'string',
    description: 'Amazon SES region (ap-south-1 for India).',
    requiredWhen: 'EMAIL_PROVIDER=ses',
    ownerIssue: 23,
    credentialIssue: 110,
  },
  SES_ACCESS_KEY_ID: {
    domain: 'email',
    type: 'string',
    description: 'Amazon SES IAM access key id.',
    requiredWhen: 'EMAIL_PROVIDER=ses',
    ownerIssue: 23,
    credentialIssue: 110,
  },
  SES_SECRET_ACCESS_KEY: {
    domain: 'email',
    type: 'secret',
    description: 'Amazon SES IAM secret access key.',
    requiredWhen: 'EMAIL_PROVIDER=ses',
    ownerIssue: 23,
    credentialIssue: 110,
    secret: true,
  },
  SMTP_URL: {
    domain: 'email',
    type: 'secret url',
    description: 'SMTP connection URL. Local default points at Mailpit (#5).',
    devDefault: 'smtp://localhost:1025',
    requiredWhen: 'EMAIL_PROVIDER=smtp',
    ownerIssue: 23,
    credentialIssue: 110,
    secret: true,
  },
  AI_PROVIDER: {
    domain: 'ai',
    type: 'enum(mock|bedrock|sarvam)',
    description: 'AI gateway provider. `mock` returns canned responses.',
    default: 'mock',
    requiredWhen: 'never (defaults to mock)',
    ownerIssue: 44,
  },
  BEDROCK_REGION: {
    domain: 'ai',
    type: 'string',
    description: 'AWS Bedrock region. Must be an India region while AI_INDIA_ONLY=true.',
    default: 'ap-south-1',
    requiredWhen: 'AI_PROVIDER=bedrock',
    ownerIssue: 44,
    credentialIssue: 112,
  },
  BEDROCK_ACCESS_KEY_ID: {
    domain: 'ai',
    type: 'string',
    description: 'AWS Bedrock IAM access key id.',
    requiredWhen: 'AI_PROVIDER=bedrock',
    ownerIssue: 44,
    credentialIssue: 112,
  },
  BEDROCK_SECRET_ACCESS_KEY: {
    domain: 'ai',
    type: 'secret',
    description: 'AWS Bedrock IAM secret access key.',
    requiredWhen: 'AI_PROVIDER=bedrock',
    ownerIssue: 44,
    credentialIssue: 112,
    secret: true,
  },
  BEDROCK_MODEL_ID: {
    domain: 'ai',
    type: 'string',
    description: 'AWS Bedrock model id.',
    requiredWhen: 'AI_PROVIDER=bedrock',
    ownerIssue: 44,
    credentialIssue: 112,
  },
  BEDROCK_DRAFTING_MODEL_ID: {
    domain: 'ai',
    type: 'string',
    description:
      'AWS Bedrock Sonnet-class model id for drafting tasks. Defaults to BEDROCK_MODEL_ID.',
    requiredWhen: 'never (optional with AI_PROVIDER=bedrock)',
    ownerIssue: 44,
    credentialIssue: 112,
  },
  AI_MAX_CONCURRENCY_PER_WORKSPACE: {
    domain: 'ai',
    type: 'integer (1-32)',
    description: 'Maximum concurrent AI gateway calls per workspace.',
    default: '4',
    requiredWhen: 'never (defaults to 4)',
    ownerIssue: 44,
  },
  SARVAM_NO_TRAINING_CONFIRMED: {
    domain: 'ai',
    type: 'literal(true)',
    description:
      'Set to true once the Sarvam contract confirms no training on customer data. Production refuses to boot with a real Sarvam key without it.',
    requiredWhen: 'NODE_ENV=production and AI_PROVIDER=sarvam',
    ownerIssue: 44,
    credentialIssue: 113,
  },
  SARVAM_API_KEY: {
    domain: 'ai',
    type: 'secret',
    description: 'Sarvam API key (Indic STT and OCR).',
    requiredWhen: 'AI_PROVIDER=sarvam',
    ownerIssue: 44,
    credentialIssue: 113,
    secret: true,
  },
  STORAGE_PROVIDER: {
    domain: 'storage',
    type: 'enum(minio|s3)',
    description: 'Object storage backend: MinIO on the VPS or AWS S3 ap-south-1.',
    default: 'minio',
    requiredWhen: 'never (defaults to minio)',
    ownerIssue: 21,
  },
  S3_ENDPOINT: {
    domain: 'storage',
    type: 'url',
    description: 'S3-compatible endpoint. Local default points at MinIO (#5).',
    devDefault: 'http://localhost:9000',
    requiredWhen: 'STORAGE_PROVIDER=minio',
    ownerIssue: 21,
  },
  S3_REGION: {
    domain: 'storage',
    type: 'string',
    description:
      'Storage region. Must be an India region (ap-south-1, ap-south-2) unless AWS_REGION_OVERRIDE_ACK is set.',
    default: 'ap-south-1',
    requiredWhen: 'never (defaults to ap-south-1)',
    ownerIssue: 21,
  },
  S3_BUCKET: {
    domain: 'storage',
    type: 'string',
    description: 'Bucket for tenant documents.',
    devDefault: 'causedeck-dev',
    requiredWhen: 'always (dev default outside production)',
    ownerIssue: 21,
  },
  S3_ACCESS_KEY: {
    domain: 'storage',
    type: 'secret',
    description: 'S3 access key.',
    devDefault: 'minioadmin',
    requiredWhen: 'always (dev default outside production)',
    ownerIssue: 21,
    credentialIssue: 116,
    secret: true,
  },
  S3_SECRET_KEY: {
    domain: 'storage',
    type: 'secret',
    description: 'S3 secret key.',
    devDefault: 'minioadmin',
    requiredWhen: 'always (dev default outside production)',
    ownerIssue: 21,
    credentialIssue: 116,
    secret: true,
  },
  BILLING_PROVIDER: {
    domain: 'billing',
    type: 'enum(mock|razorpay)',
    description: 'Billing provider. `mock` simulates subscriptions.',
    default: 'mock',
    requiredWhen: 'never (defaults to mock)',
    ownerIssue: 28,
  },
  RAZORPAY_KEY_ID: {
    domain: 'billing',
    type: 'string',
    description: 'Razorpay API key id.',
    requiredWhen: 'BILLING_PROVIDER=razorpay',
    ownerIssue: 28,
    credentialIssue: 111,
  },
  RAZORPAY_SECRET: {
    domain: 'billing',
    type: 'secret',
    description: 'Razorpay API key secret.',
    requiredWhen: 'BILLING_PROVIDER=razorpay',
    ownerIssue: 28,
    credentialIssue: 111,
    secret: true,
  },
  RAZORPAY_WEBHOOK_SECRET: {
    domain: 'billing',
    type: 'secret',
    description: 'Razorpay webhook signing secret.',
    requiredWhen: 'BILLING_PROVIDER=razorpay',
    ownerIssue: 28,
    credentialIssue: 111,
    secret: true,
  },
  AUTH_GOOGLE_ENABLED: {
    domain: 'auth',
    type: 'boolean',
    description: 'Enable Google OAuth sign-in.',
    default: 'false',
    requiredWhen: 'never (defaults to false)',
    ownerIssue: 12,
  },
  GOOGLE_CLIENT_ID: {
    domain: 'auth',
    type: 'string',
    description: 'Google OAuth client id.',
    requiredWhen: 'AUTH_GOOGLE_ENABLED=true',
    ownerIssue: 12,
    credentialIssue: 109,
  },
  GOOGLE_CLIENT_SECRET: {
    domain: 'auth',
    type: 'secret',
    description: 'Google OAuth client secret.',
    requiredWhen: 'AUTH_GOOGLE_ENABLED=true',
    ownerIssue: 12,
    credentialIssue: 109,
    secret: true,
  },
  SENTRY_ENABLED: {
    domain: 'observability',
    type: 'boolean',
    description: 'Report errors to Sentry.',
    default: 'false',
    requiredWhen: 'never (defaults to false)',
    ownerIssue: 13,
  },
  SENTRY_DSN: {
    domain: 'observability',
    type: 'url',
    description: 'Sentry DSN.',
    requiredWhen: 'SENTRY_ENABLED=true',
    ownerIssue: 13,
    credentialIssue: 115,
  },
} satisfies KeyMetaRecord;

const d = (name: keyof typeof providerKeys) => providerKeys[name].description;
const on = z.literal('true').transform(() => true as const);
const off = z.literal('false').transform(() => false as const);

export const emailProvider = z.discriminatedUnion('EMAIL_PROVIDER', [
  z.object({ EMAIL_PROVIDER: z.literal('console').describe(d('EMAIL_PROVIDER')) }),
  z.object({
    EMAIL_PROVIDER: z.literal('ses'),
    SES_REGION: required.describe(d('SES_REGION')),
    SES_ACCESS_KEY_ID: required.describe(d('SES_ACCESS_KEY_ID')),
    SES_SECRET_ACCESS_KEY: secret(required).describe(d('SES_SECRET_ACCESS_KEY')),
  }),
  z.object({
    EMAIL_PROVIDER: z.literal('smtp'),
    SMTP_URL: secret(z.url({ protocol: /^smtps?$/ })).describe(d('SMTP_URL')),
  }),
]);

const aiCommon = {
  AI_MAX_CONCURRENCY_PER_WORKSPACE: z.coerce
    .number()
    .int()
    .min(1)
    .max(32)
    .describe(d('AI_MAX_CONCURRENCY_PER_WORKSPACE')),
};

export const aiProvider = z.discriminatedUnion('AI_PROVIDER', [
  z.object({ AI_PROVIDER: z.literal('mock').describe(d('AI_PROVIDER')), ...aiCommon }),
  z.object({
    ...aiCommon,
    AI_PROVIDER: z.literal('bedrock'),
    BEDROCK_REGION: required.describe(d('BEDROCK_REGION')),
    BEDROCK_ACCESS_KEY_ID: required.describe(d('BEDROCK_ACCESS_KEY_ID')),
    BEDROCK_SECRET_ACCESS_KEY: secret(required).describe(d('BEDROCK_SECRET_ACCESS_KEY')),
    BEDROCK_MODEL_ID: required.describe(d('BEDROCK_MODEL_ID')),
    BEDROCK_DRAFTING_MODEL_ID: z
      .string()
      .min(1)
      .optional()
      .describe(d('BEDROCK_DRAFTING_MODEL_ID')),
  }),
  z.object({
    ...aiCommon,
    AI_PROVIDER: z.literal('sarvam'),
    SARVAM_API_KEY: secret(required).describe(d('SARVAM_API_KEY')),
    SARVAM_NO_TRAINING_CONFIRMED: on.optional().describe(d('SARVAM_NO_TRAINING_CONFIRMED')),
  }),
]);

const s3Credentials = {
  S3_REGION: required.describe(d('S3_REGION')),
  S3_BUCKET: required.describe(d('S3_BUCKET')),
  S3_ACCESS_KEY: secret(required).describe(d('S3_ACCESS_KEY')),
  S3_SECRET_KEY: secret(required).describe(d('S3_SECRET_KEY')),
};

export const storageProvider = z.discriminatedUnion('STORAGE_PROVIDER', [
  z.object({
    STORAGE_PROVIDER: z.literal('minio').describe(d('STORAGE_PROVIDER')),
    S3_ENDPOINT: z.url().describe(d('S3_ENDPOINT')),
    ...s3Credentials,
  }),
  z.object({
    STORAGE_PROVIDER: z.literal('s3'),
    S3_ENDPOINT: z.url().optional().describe(d('S3_ENDPOINT')),
    ...s3Credentials,
  }),
]);

export const billingProvider = z.discriminatedUnion('BILLING_PROVIDER', [
  z.object({ BILLING_PROVIDER: z.literal('mock').describe(d('BILLING_PROVIDER')) }),
  z.object({
    BILLING_PROVIDER: z.literal('razorpay'),
    RAZORPAY_KEY_ID: required.describe(d('RAZORPAY_KEY_ID')),
    RAZORPAY_SECRET: secret(required).describe(d('RAZORPAY_SECRET')),
    RAZORPAY_WEBHOOK_SECRET: secret(required).describe(d('RAZORPAY_WEBHOOK_SECRET')),
  }),
]);

export const googleAuth = z.discriminatedUnion('AUTH_GOOGLE_ENABLED', [
  z.object({ AUTH_GOOGLE_ENABLED: off.describe(d('AUTH_GOOGLE_ENABLED')) }),
  z.object({
    AUTH_GOOGLE_ENABLED: on,
    GOOGLE_CLIENT_ID: required.describe(d('GOOGLE_CLIENT_ID')),
    GOOGLE_CLIENT_SECRET: secret(required).describe(d('GOOGLE_CLIENT_SECRET')),
  }),
]);

export const sentry = z.discriminatedUnion('SENTRY_ENABLED', [
  z.object({ SENTRY_ENABLED: off.describe(d('SENTRY_ENABLED')) }),
  z.object({ SENTRY_ENABLED: on, SENTRY_DSN: z.url().describe(d('SENTRY_DSN')) }),
]);

export const providerSchemas = [
  emailProvider,
  aiProvider,
  storageProvider,
  billingProvider,
  googleAuth,
  sentry,
] as const;

/** Boolean switches used as union discriminators; normalised to `'true'`/`'false'` first. */
export const BOOLEAN_SWITCHES = ['AUTH_GOOGLE_ENABLED', 'SENTRY_ENABLED'] as const;

/** Provider values that only simulate an integration; rejected in production by default. */
export const MOCK_PROVIDERS = {
  EMAIL_PROVIDER: 'console',
  AI_PROVIDER: 'mock',
  BILLING_PROVIDER: 'mock',
} as const;

export type ProviderEnv = z.output<typeof emailProvider> &
  z.output<typeof aiProvider> &
  z.output<typeof storageProvider> &
  z.output<typeof billingProvider> &
  z.output<typeof googleAuth> &
  z.output<typeof sentry>;
