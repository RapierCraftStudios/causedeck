// Composed env schema (spike §3.2, §9): `shared` and `server` keys, the provider unions and the
// `NEXT_PUBLIC_*` client keys. Validation collects every issue so callers get one aggregated error.
import type { StandardSchemaV1 } from '@t3-oss/env-core';
import { z } from 'zod';

import { clientKeys, clientShape } from './client.ts';
import {
  BOOLEAN_SWITCHES,
  INDIA_AWS_REGIONS,
  MOCK_PROVIDERS,
  providerKeys,
  providerSchemas,
  type ProviderEnv,
} from './providers.ts';
import { applyDefaults, specsOf, type KeyMetaRecord, type KeySpec } from './registry.ts';
import { secret } from './secret.ts';

/** Value an operator must type to confirm a deliberate guardrail override. */
export const OVERRIDE_ACK = 'I_UNDERSTAND';

/** Dev-only placeholders; production rejects them even when supplied explicitly. */
export const DEV_BETTER_AUTH_SECRET = 'dev-only-insecure-better-auth-secret-change-me';
export const DEV_STATUS_SIGNING_KEY = 'dev-only-insecure-status-signing-key-change-me';
export const DEV_KEK_BASE64 = Buffer.alloc(32).toString('base64');

export const KILL_SWITCH_PATTERN = /^KILL_[A-Z0-9_]+$/;

export const sharedKeys = {
  NODE_ENV: {
    domain: 'shared',
    type: 'enum(development|test|production)',
    description: 'Runtime mode. Dev defaults apply only when this is not `production`.',
    default: 'development',
    requiredWhen: 'never (defaults to development)',
    ownerIssue: 4,
  },
  CI: {
    domain: 'shared',
    type: 'boolean',
    description: 'Set by CI runners.',
    default: 'false',
    requiredWhen: 'never',
    ownerIssue: 3,
  },
  LOG_LEVEL: {
    domain: 'shared',
    type: 'enum(fatal|error|warn|info|debug|trace|silent)',
    description: 'pino log level.',
    default: 'info',
    requiredWhen: 'never (defaults to info)',
    ownerIssue: 13,
  },
  AWS_REGION: {
    domain: 'shared',
    type: 'string',
    description:
      'AWS region for infrastructure. Must be in India unless AWS_REGION_OVERRIDE_ACK is set.',
    default: 'ap-south-1',
    requiredWhen: 'never (defaults to ap-south-1)',
    ownerIssue: 4,
  },
  DATA_REGION: {
    domain: 'shared',
    type: 'string',
    description: 'Data residency region. Must be `in` unless AWS_REGION_OVERRIDE_ACK is set.',
    default: 'in',
    requiredWhen: 'never (defaults to in)',
    ownerIssue: 4,
  },
  AWS_REGION_OVERRIDE_ACK: {
    domain: 'shared',
    type: `literal(${OVERRIDE_ACK})`,
    description: `Set to ${OVERRIDE_ACK} to allow a non-India AWS_REGION or DATA_REGION.`,
    requiredWhen: 'AWS_REGION or DATA_REGION outside India',
    ownerIssue: 4,
  },
  AI_INDIA_ONLY: {
    domain: 'shared',
    type: 'boolean',
    description: 'Restrict AI processing to India-hosted providers.',
    default: 'true',
    requiredWhen: 'never (defaults to true)',
    ownerIssue: 44,
  },
  AI_INDIA_ONLY_OVERRIDE_ACK: {
    domain: 'shared',
    type: `literal(${OVERRIDE_ACK})`,
    description: `Set to ${OVERRIDE_ACK} to allow AI_INDIA_ONLY=false in production.`,
    requiredWhen: 'NODE_ENV=production and AI_INDIA_ONLY=false',
    ownerIssue: 44,
  },
  ALLOW_MOCK_PROVIDERS: {
    domain: 'shared',
    type: 'boolean',
    description: 'Allow mock/console providers in production (staging demos only).',
    default: 'false',
    requiredWhen: 'never',
    ownerIssue: 4,
  },
  SKIP_ENV_VALIDATION: {
    domain: 'shared',
    type: 'literal(1)',
    description: 'Set to 1 to skip validation during Docker image builds. Never set it at runtime.',
    requiredWhen: 'never',
    ownerIssue: 4,
  },
} satisfies KeyMetaRecord;

// The #5 stack's least-privilege roles (infra/docker/postgres/init/02-roles.sql), never the superuser.
const LOCAL_DATABASE_URL = 'postgres://causedeck_app:causedeck_app@localhost:5432/causedeck';
const LOCAL_DATABASE_URL_OWNER =
  'postgres://causedeck_owner:causedeck_owner@localhost:5432/causedeck';

export const serverKeys = {
  DATABASE_URL: {
    domain: 'server',
    type: 'secret url',
    description: 'Postgres connection URL for the app role. Local default points at #5 Postgres.',
    devDefault: LOCAL_DATABASE_URL,
    requiredWhen: 'NODE_ENV=production',
    ownerIssue: 6,
    credentialIssue: 116,
    secret: true,
  },
  DATABASE_URL_OWNER: {
    domain: 'server',
    type: 'secret url',
    description: 'Postgres connection URL for the schema owner role (migrations).',
    devDefault: LOCAL_DATABASE_URL_OWNER,
    requiredWhen: 'running migrations',
    ownerIssue: 6,
    credentialIssue: 116,
    secret: true,
  },
  APP_URL: {
    domain: 'server',
    type: 'url',
    description: 'Public URL of the web app.',
    devDefault: 'http://localhost:3000',
    requiredWhen: 'NODE_ENV=production',
    ownerIssue: 10,
  },
  API_URL: {
    domain: 'server',
    type: 'url',
    description: 'Public URL of the API service.',
    devDefault: 'http://localhost:3001',
    requiredWhen: 'NODE_ENV=production',
    ownerIssue: 14,
  },
  BETTER_AUTH_SECRET: {
    domain: 'server',
    type: 'secret (>= 32 chars)',
    description: 'Better Auth signing secret, at least 32 characters.',
    devDefault: DEV_BETTER_AUTH_SECRET,
    requiredWhen: 'NODE_ENV=production',
    ownerIssue: 12,
    credentialIssue: 116,
    secret: true,
  },
  STATUS_SIGNING_KEY: {
    domain: 'server',
    type: 'secret (>= 32 chars)',
    description:
      'HMAC key that signs the public status snapshot (status/status.json), at least 32 characters.',
    devDefault: DEV_STATUS_SIGNING_KEY,
    requiredWhen: 'NODE_ENV=production',
    ownerIssue: 769,
    secret: true,
  },
  KEK_BASE64: {
    domain: 'server',
    type: 'secret base64 (32 bytes)',
    description: 'Key-encryption key for envelope encryption, base64 of exactly 32 bytes.',
    devDefault: DEV_KEK_BASE64,
    requiredWhen: 'NODE_ENV=production',
    ownerIssue: 21,
    credentialIssue: 116,
    secret: true,
  },
  VAPID_PUBLIC_KEY: {
    domain: 'server',
    type: 'string',
    description: 'Web push VAPID public key.',
    requiredWhen: 'VAPID_PRIVATE_KEY is set',
    ownerIssue: 23,
    credentialIssue: 116,
  },
  VAPID_PRIVATE_KEY: {
    domain: 'server',
    type: 'secret',
    description: 'Web push VAPID private key.',
    requiredWhen: 'VAPID_PUBLIC_KEY is set',
    ownerIssue: 23,
    credentialIssue: 116,
    secret: true,
  },
  VAPID_SUBJECT: {
    domain: 'server',
    type: 'mailto: or https url',
    description:
      'Web push VAPID subject (contact for push services). Defaults to mailto:push@<APP_URL host>.',
    requiredWhen: 'never',
    ownerIssue: 197,
  },
  WHATSAPP_PHONE_NUMBER_ID: {
    domain: 'server',
    type: 'string',
    description: 'WhatsApp Business Platform phone number id that outbound messages are sent from.',
    requiredWhen: 'WHATSAPP_ACCESS_TOKEN is set',
    ownerIssue: 679,
    credentialIssue: 488,
  },
  WHATSAPP_ACCESS_TOKEN: {
    domain: 'server',
    type: 'secret',
    description:
      'WhatsApp Business Platform access token. Without it WhatsApp delivery is disabled.',
    requiredWhen: 'WHATSAPP_PHONE_NUMBER_ID is set',
    ownerIssue: 679,
    credentialIssue: 488,
    secret: true,
  },
  WHATSAPP_API_VERSION: {
    domain: 'server',
    type: 'string (vNN.N)',
    description: 'WhatsApp Business Platform Graph API version. Defaults to v21.0.',
    requiredWhen: 'never',
    ownerIssue: 679,
  },
  WHATSAPP_OTP_TEMPLATE_NAME: {
    domain: 'server',
    type: 'string',
    description:
      'Name of the provider-approved WhatsApp authentication template for link codes (#711). Set it only after the provider approved the template (#708, #488); without it, and without the provider env, link codes go to the console sender outside production and are not delivered in production.',
    requiredWhen: 'never',
    ownerIssue: 711,
    credentialIssue: 488,
  },
  OTEL_EXPORTER_OTLP_ENDPOINT: {
    domain: 'server',
    type: 'url',
    description: 'OpenTelemetry OTLP exporter endpoint. Tracing export is off when unset.',
    requiredWhen: 'never',
    ownerIssue: 13,
  },
  API_PORT: {
    domain: 'server',
    type: 'port',
    description: 'Port the API service listens on.',
    default: '3001',
    requiredWhen: 'never',
    ownerIssue: 14,
  },
  WORKER_PORT: {
    domain: 'server',
    type: 'port',
    description: 'Port the worker serves /healthz and /readyz on.',
    default: '3003',
    requiredWhen: 'never',
    ownerIssue: 15,
  },
  GIT_SHA: {
    domain: 'server',
    type: 'string',
    description: 'Build commit SHA; used as the service version and Sentry release.',
    requiredWhen: 'never',
    ownerIssue: 13,
  },
  ADMIN_URL: {
    domain: 'server',
    type: 'url',
    description: 'Public URL of the staff admin console (apps/admin).',
    devDefault: 'http://localhost:3200',
    requiredWhen: 'NODE_ENV=production, for apps/admin only',
    ownerIssue: 309,
  },
  ADMIN_IP_ALLOWLIST: {
    domain: 'server',
    type: 'list (comma-separated IPs/CIDRs)',
    description:
      'Optional client IP allowlist for apps/admin (IPv4/IPv6 addresses or CIDRs, comma-separated). Unset allows any IP.',
    requiredWhen: 'never (set per deployment)',
    ownerIssue: 309,
  },
  CF_ACCESS_AUD: {
    domain: 'server',
    type: 'string',
    description:
      'Cloudflare Access application audience tag. When set, apps/admin requires a valid Cf-Access-Jwt-Assertion.',
    requiredWhen: 'never (set per deployment)',
    ownerIssue: 309,
  },
  CF_ACCESS_TEAM_DOMAIN: {
    domain: 'server',
    type: 'host',
    description:
      'Cloudflare Access team domain that signs the JWT, e.g. team.cloudflareaccess.com.',
    requiredWhen: 'CF_ACCESS_AUD is set',
    ownerIssue: 309,
  },
  ADMIN_ENV_LABEL: {
    domain: 'server',
    type: 'enum(development|staging|production)',
    description:
      'Environment tag shown in the admin console strip. Defaults to production when NODE_ENV=production, else development.',
    requiredWhen: 'never',
    ownerIssue: 309,
  },
  BILLING_SUPPLIER_LEGAL_NAME: {
    domain: 'server',
    type: 'string',
    description:
      'Legal name of the supplier on SaaS GST invoices. Outside production a TEST supplier is used when unset.',
    requiredWhen: 'never (issuing an invoice in production refuses while unset)',
    ownerIssue: 253,
  },
  BILLING_SUPPLIER_ADDRESS: {
    domain: 'server',
    type: 'string',
    description: 'Registered address of the supplier on SaaS GST invoices.',
    requiredWhen: 'never',
    ownerIssue: 253,
  },
  BILLING_SUPPLIER_GSTIN: {
    domain: 'server',
    type: 'GSTIN',
    description:
      'GSTIN of the supplier on SaaS GST invoices; its state code decides CGST+SGST or IGST.',
    requiredWhen: 'never (issuing an invoice in production refuses while unset)',
    ownerIssue: 253,
  },
  BILLING_INVOICE_SERIES: {
    domain: 'server',
    type: 'string (1-3 capitals)',
    description: 'SaaS invoice number series, as in CD/26-27/000001.',
    default: 'CD',
    requiredWhen: 'never (defaults to CD)',
    ownerIssue: 253,
  },
  BILLING_SAC: {
    domain: 'server',
    type: 'string (99xxxx)',
    description: 'SAC printed on SaaS GST invoices (needs CA confirmation).',
    default: '998314',
    requiredWhen: 'never (defaults to 998314)',
    ownerIssue: 253,
  },
  ADAPTER_PRIVATE_FIXTURES_DIR: {
    domain: 'server',
    type: 'path',
    description:
      'Directory of lawyer-supplied adapter fixtures (<adapter-id>/manifest.json layout) for the golden runner. Never committed; unset in CI.',
    requiredWhen: 'never',
    ownerIssue: 371,
  },
  ALTERLAB_API_KEY: {
    domain: 'server',
    type: 'secret',
    description:
      'AlterLab API key for the governed fetch layer. Unset means the offline mock provider serves fixtures.',
    requiredWhen: 'never (the mock provider is used when unset)',
    ownerIssue: 479,
    secret: true,
  },
  DATA_OPS_SLACK_WEBHOOK_URL: {
    domain: 'server',
    type: 'secret',
    description:
      'Slack incoming-webhook URL for data-ops alerts. Unset means alerts go to the email mailbox or the log.',
    requiredWhen: 'never (alerts are logged when unset)',
    ownerIssue: 515,
    secret: true,
  },
  DATA_OPS_ALERT_EMAIL: {
    domain: 'server',
    type: 'email',
    description:
      'Mailbox that receives data-ops alerts, besides the on-call staff member. Unset means no mailbox.',
    requiredWhen: 'never (alerts are logged when unset)',
    ownerIssue: 515,
  },
  FETCH_DELEGATED_CAPTCHA_PER_HOUR: {
    domain: 'server',
    type: 'integer (1-1000)',
    description:
      'Per-advocate hourly allowance for delegated captcha-tier lookups in the governed fetch layer.',
    default: '10',
    requiredWhen: 'never (defaults to 10)',
    ownerIssue: 479,
  },
  BUSINESS_FOUNDER_EMAILS: {
    domain: 'server',
    type: 'list (comma-separated emails)',
    description:
      'Founders who receive the weekly business digest and cost-per-user alerts. Unset sends nothing.',
    requiredWhen: 'never (set per deployment)',
    ownerIssue: 519,
  },
  BUSINESS_INFRA_COST_PAISE_MONTHLY: {
    domain: 'server',
    type: 'integer (paise)',
    description:
      'Monthly infrastructure cost in paise, spread over active users in the business dashboard (infra is not metered).',
    default: '0',
    requiredWhen: 'never (defaults to 0)',
    ownerIssue: 519,
  },
  BUSINESS_COST_PER_USER_ALERT_PAISE: {
    domain: 'server',
    type: 'integer (paise)',
    description:
      'Monthly cost to serve per active user, in paise, above which a plan raises a business alert.',
    default: '4000',
    requiredWhen: 'never (defaults to 4000)',
    ownerIssue: 519,
  },
  BUSINESS_USD_INR: {
    domain: 'server',
    type: 'number (INR per USD)',
    description: 'Exchange rate used to turn fetch_log dollar costs into paise.',
    default: '85',
    requiredWhen: 'never (defaults to 85)',
    ownerIssue: 519,
  },
} satisfies KeyMetaRecord;

export const killSwitchKeys = {
  'KILL_*': {
    domain: 'kill-switches',
    type: 'boolean',
    description:
      'Env kill-switches, e.g. KILL_AI=true. Every KILL_<NAME> key is parsed as a boolean.',
    requiredWhen: 'never',
    ownerIssue: 22,
  },
} satisfies KeyMetaRecord;

/** Every key the schema knows about, in `.env.example` order. */
export const envRegistry: KeySpec[] = [
  ...specsOf(sharedKeys),
  ...specsOf(serverKeys),
  ...specsOf(providerKeys),
  ...specsOf(clientKeys),
  ...specsOf(killSwitchKeys),
];

const defaultableKeys: KeyMetaRecord = {
  ...sharedKeys,
  ...serverKeys,
  ...providerKeys,
  ...clientKeys,
};

const d = (meta: { description: string }) => meta.description;
const ack = z.literal(OVERRIDE_ACK).optional();

export const sharedShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).describe(d(sharedKeys.NODE_ENV)),
  CI: z.stringbool().describe(d(sharedKeys.CI)),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .describe(d(sharedKeys.LOG_LEVEL)),
  AWS_REGION: z.string().min(1).describe(d(sharedKeys.AWS_REGION)),
  DATA_REGION: z.string().min(1).describe(d(sharedKeys.DATA_REGION)),
  AWS_REGION_OVERRIDE_ACK: ack.describe(d(sharedKeys.AWS_REGION_OVERRIDE_ACK)),
  AI_INDIA_ONLY: z.stringbool().describe(d(sharedKeys.AI_INDIA_ONLY)),
  AI_INDIA_ONLY_OVERRIDE_ACK: ack.describe(d(sharedKeys.AI_INDIA_ONLY_OVERRIDE_ACK)),
  ALLOW_MOCK_PROVIDERS: z.stringbool().describe(d(sharedKeys.ALLOW_MOCK_PROVIDERS)),
  SKIP_ENV_VALIDATION: z.literal('1').optional().describe(d(sharedKeys.SKIP_ENV_VALIDATION)),
};

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const ipOrCidr = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

/** `ADMIN_IP_ALLOWLIST`: one or more comma-separated IPv4/IPv6 addresses or CIDRs. */
export function isIpAllowlist(value: string): boolean {
  const entries = value.split(',').map((entry) => entry.trim());
  return entries.length > 0 && entries.every((entry) => ipOrCidr.safeParse(entry).success);
}

export const serverShape = {
  DATABASE_URL: secret(postgresUrl).describe(d(serverKeys.DATABASE_URL)),
  DATABASE_URL_OWNER: secret(postgresUrl).optional().describe(d(serverKeys.DATABASE_URL_OWNER)),
  APP_URL: z.url().describe(d(serverKeys.APP_URL)),
  API_URL: z.url().describe(d(serverKeys.API_URL)),
  BETTER_AUTH_SECRET: secret(z.string().min(32, 'must be at least 32 characters')).describe(
    d(serverKeys.BETTER_AUTH_SECRET),
  ),
  STATUS_SIGNING_KEY: secret(z.string().min(32, 'must be at least 32 characters')).describe(
    d(serverKeys.STATUS_SIGNING_KEY),
  ),
  KEK_BASE64: secret(
    z
      .base64()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must decode to exactly 32 bytes'),
  ).describe(d(serverKeys.KEK_BASE64)),
  VAPID_PUBLIC_KEY: z.string().min(1).optional().describe(d(serverKeys.VAPID_PUBLIC_KEY)),
  VAPID_PRIVATE_KEY: secret(z.string().min(1)).optional().describe(d(serverKeys.VAPID_PRIVATE_KEY)),
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:\S+@\S+|https:\/\/\S+)$/, 'must be a mailto: address or an https URL')
    .optional()
    .describe(d(serverKeys.VAPID_SUBJECT)),
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .min(1)
    .optional()
    .describe(d(serverKeys.WHATSAPP_PHONE_NUMBER_ID)),
  WHATSAPP_ACCESS_TOKEN: secret(z.string().min(1))
    .optional()
    .describe(d(serverKeys.WHATSAPP_ACCESS_TOKEN)),
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'must look like v21.0')
    .optional()
    .describe(d(serverKeys.WHATSAPP_API_VERSION)),
  WHATSAPP_OTP_TEMPLATE_NAME: z
    .string()
    .regex(/^[a-z0-9_]{1,512}$/, 'must be a lowercase template name (a-z, 0-9, _)')
    .optional()
    .describe(d(serverKeys.WHATSAPP_OTP_TEMPLATE_NAME)),
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .url()
    .optional()
    .describe(d(serverKeys.OTEL_EXPORTER_OTLP_ENDPOINT)),
  API_PORT: z.coerce.number().int().min(1).max(65535).describe(d(serverKeys.API_PORT)),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).describe(d(serverKeys.WORKER_PORT)),
  GIT_SHA: z.string().min(1).optional().describe(d(serverKeys.GIT_SHA)),
  // The staff admin console (#309); its own accessor requires ADMIN_URL in production.
  ADMIN_URL: z.url().optional().describe(d(serverKeys.ADMIN_URL)),
  ADMIN_IP_ALLOWLIST: z
    .string()
    .refine(isIpAllowlist, 'must be comma-separated IPv4/IPv6 addresses or CIDRs')
    .optional()
    .describe(d(serverKeys.ADMIN_IP_ALLOWLIST)),
  CF_ACCESS_AUD: z.string().min(1).optional().describe(d(serverKeys.CF_ACCESS_AUD)),
  CF_ACCESS_TEAM_DOMAIN: z
    .string()
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'must be a host name, e.g. team.cloudflareaccess.com')
    .optional()
    .describe(d(serverKeys.CF_ACCESS_TEAM_DOMAIN)),
  ADMIN_ENV_LABEL: z
    .enum(['development', 'staging', 'production'])
    .optional()
    .describe(d(serverKeys.ADMIN_ENV_LABEL)),
  // Checked when an invoice is issued (`@causedeck/billing/config/supplier`), not at boot.
  BILLING_SUPPLIER_LEGAL_NAME: z
    .string()
    .optional()
    .describe(d(serverKeys.BILLING_SUPPLIER_LEGAL_NAME)),
  BILLING_SUPPLIER_ADDRESS: z.string().optional().describe(d(serverKeys.BILLING_SUPPLIER_ADDRESS)),
  BILLING_SUPPLIER_GSTIN: z.string().optional().describe(d(serverKeys.BILLING_SUPPLIER_GSTIN)),
  BILLING_INVOICE_SERIES: z
    .string()
    .regex(/^[A-Z]{1,3}$/, 'must be 1-3 capital letters')
    .describe(d(serverKeys.BILLING_INVOICE_SERIES)),
  BILLING_SAC: z
    .string()
    .regex(/^99[0-9]{4}$/, 'must be a six-digit SAC starting 99')
    .describe(d(serverKeys.BILLING_SAC)),
  // Lawyer-supplied golden fixtures (#371); the golden runner skips the private set when unset.
  ADAPTER_PRIVATE_FIXTURES_DIR: z
    .string()
    .min(1)
    .optional()
    .describe(d(serverKeys.ADAPTER_PRIVATE_FIXTURES_DIR)),
  // The governed fetch layer (#479, D-048): no key means the mock provider.
  ALTERLAB_API_KEY: secret(z.string().min(1)).optional().describe(d(serverKeys.ALTERLAB_API_KEY)),
  // Data-ops alert routing (#515, D-049): both unset means alerts are logged.
  DATA_OPS_SLACK_WEBHOOK_URL: secret(z.url())
    .optional()
    .describe(d(serverKeys.DATA_OPS_SLACK_WEBHOOK_URL)),
  DATA_OPS_ALERT_EMAIL: z.email().optional().describe(d(serverKeys.DATA_OPS_ALERT_EMAIL)),
  FETCH_DELEGATED_CAPTCHA_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .describe(d(serverKeys.FETCH_DELEGATED_CAPTCHA_PER_HOUR)),
  BUSINESS_FOUNDER_EMAILS: z
    .string()
    .refine(
      (v) => v.split(',').every((e) => z.email().safeParse(e.trim()).success),
      'must be comma-separated email addresses',
    )
    .optional()
    .describe(d(serverKeys.BUSINESS_FOUNDER_EMAILS)),
  BUSINESS_INFRA_COST_PAISE_MONTHLY: z.coerce
    .number()
    .int()
    .min(0)
    .describe(d(serverKeys.BUSINESS_INFRA_COST_PAISE_MONTHLY)),
  BUSINESS_COST_PER_USER_ALERT_PAISE: z.coerce
    .number()
    .int()
    .min(1)
    .describe(d(serverKeys.BUSINESS_COST_PER_USER_ALERT_PAISE)),
  BUSINESS_USD_INR: z.coerce.number().positive().describe(d(serverKeys.BUSINESS_USD_INR)),
};

const baseSchema = z.object({ ...sharedShape, ...serverShape, ...clientShape });

export type ServerEnv = z.output<typeof baseSchema> &
  ProviderEnv & {
    /** Parsed `KILL_*` switches keyed by full env name, consumed by #22. */
    killSwitches: Readonly<Record<string, boolean>>;
  };

export type RawEnv = Record<string, string | undefined>;

type Issue = StandardSchemaV1.Issue;

function normaliseBooleanSwitches(env: RawEnv): void {
  const bool = z.stringbool();
  for (const key of BOOLEAN_SWITCHES) {
    const parsed = bool.safeParse(env[key]);
    if (parsed.success) env[key] = String(parsed.data);
  }
}

function isIndiaRegion(region: string): boolean {
  return (INDIA_AWS_REGIONS as readonly string[]).includes(region);
}

/** Cross-key guardrails: production hardening, India-only AI and data residency. */
export function guardrailIssues(env: RawEnv, parsed: Partial<ServerEnv>): Issue[] {
  const issues: Issue[] = [];
  const add = (key: string, message: string) => issues.push({ path: [key], message });
  const isProd = env.NODE_ENV === 'production';
  const regionAck = env.AWS_REGION_OVERRIDE_ACK === OVERRIDE_ACK;

  if (env.AWS_REGION !== undefined && !isIndiaRegion(env.AWS_REGION) && !regionAck) {
    add(
      'AWS_REGION',
      `must be an India region (${INDIA_AWS_REGIONS.join(', ')}) unless AWS_REGION_OVERRIDE_ACK=${OVERRIDE_ACK}`,
    );
  }
  if (env.DATA_REGION !== undefined && env.DATA_REGION !== 'in' && !regionAck) {
    add('DATA_REGION', `must be "in" unless AWS_REGION_OVERRIDE_ACK=${OVERRIDE_ACK}`);
  }
  if (env.S3_REGION !== undefined && !isIndiaRegion(env.S3_REGION) && !regionAck) {
    add(
      'S3_REGION',
      `must be an India region (${INDIA_AWS_REGIONS.join(', ')}) unless AWS_REGION_OVERRIDE_ACK=${OVERRIDE_ACK}`,
    );
  }
  if (
    parsed.AI_INDIA_ONLY !== false &&
    env.AI_PROVIDER === 'bedrock' &&
    env.BEDROCK_REGION !== undefined &&
    !isIndiaRegion(env.BEDROCK_REGION)
  ) {
    add('BEDROCK_REGION', 'must be an India region while AI_INDIA_ONLY=true');
  }
  if (
    env.EMAIL_PROVIDER === 'ses' &&
    env.SES_REGION !== undefined &&
    env.SES_REGION !== '' &&
    !isIndiaRegion(env.SES_REGION) &&
    !regionAck
  ) {
    add(
      'SES_REGION',
      `must be an India region (${INDIA_AWS_REGIONS.join(', ')}) unless AWS_REGION_OVERRIDE_ACK=${OVERRIDE_ACK}`,
    );
  }

  if (env.CF_ACCESS_AUD !== undefined && env.CF_ACCESS_TEAM_DOMAIN === undefined) {
    add('CF_ACCESS_TEAM_DOMAIN', 'is required when CF_ACCESS_AUD is set');
  }

  if (!isProd) return issues;

  if (parsed.AI_INDIA_ONLY === false && env.AI_INDIA_ONLY_OVERRIDE_ACK !== OVERRIDE_ACK) {
    add(
      'AI_INDIA_ONLY_OVERRIDE_ACK',
      `must be ${OVERRIDE_ACK} to set AI_INDIA_ONLY=false in production`,
    );
  }
  if (
    env.AI_PROVIDER === 'sarvam' &&
    env.SARVAM_API_KEY !== undefined &&
    env.SARVAM_API_KEY !== '' &&
    env.SARVAM_NO_TRAINING_CONFIRMED !== 'true'
  ) {
    add(
      'SARVAM_NO_TRAINING_CONFIRMED',
      'must be true in production when a real Sarvam key is set (contract no-training term)',
    );
  }
  if (parsed.ALLOW_MOCK_PROVIDERS !== true) {
    for (const [key, mock] of Object.entries(MOCK_PROVIDERS)) {
      if (env[key] === mock) {
        add(
          key,
          `"${mock}" is a mock provider; select a real provider or set ALLOW_MOCK_PROVIDERS=true`,
        );
      }
    }
  }
  if (env.BETTER_AUTH_SECRET === DEV_BETTER_AUTH_SECRET) {
    add('BETTER_AUTH_SECRET', 'must not use the development placeholder in production');
  }
  if (env.STATUS_SIGNING_KEY === DEV_STATUS_SIGNING_KEY) {
    add('STATUS_SIGNING_KEY', 'must not use the development placeholder in production');
  }
  if (env.KEK_BASE64 === DEV_KEK_BASE64) {
    add('KEK_BASE64', 'must not use the development placeholder in production');
  }
  if ((env.VAPID_PUBLIC_KEY === undefined) !== (env.VAPID_PRIVATE_KEY === undefined)) {
    add(
      env.VAPID_PUBLIC_KEY === undefined ? 'VAPID_PUBLIC_KEY' : 'VAPID_PRIVATE_KEY',
      'VAPID keys must be set together',
    );
  }
  if ((env.WHATSAPP_PHONE_NUMBER_ID === undefined) !== (env.WHATSAPP_ACCESS_TOKEN === undefined)) {
    add(
      env.WHATSAPP_PHONE_NUMBER_ID === undefined
        ? 'WHATSAPP_PHONE_NUMBER_ID'
        : 'WHATSAPP_ACCESS_TOKEN',
      'WhatsApp phone number id and access token must be set together',
    );
  }
  return issues;
}

function toIssues(error: z.ZodError, env: RawEnv): Issue[] {
  return error.issues.map((issue) => {
    const key = String(issue.path[0] ?? '');
    const missing = issue.code === 'invalid_type' && key !== '' && env[key] === undefined;
    return { path: issue.path, message: missing ? 'is required' : issue.message };
  });
}

/** Validate a raw env record, returning every issue across all keys at once. */
export function validateServerEnv(input: RawEnv): StandardSchemaV1.Result<ServerEnv> {
  const env = applyDefaults(defaultableKeys, input);
  normaliseBooleanSwitches(env);

  const issues: Issue[] = [];
  let value: Record<string, unknown> = {};
  for (const schema of [baseSchema, ...providerSchemas]) {
    const result = schema.safeParse(env);
    if (result.success) value = { ...value, ...result.data };
    else issues.push(...toIssues(result.error, env));
  }

  const killSwitches: Record<string, boolean> = {};
  const bool = z.stringbool();
  for (const [key, raw] of Object.entries(env)) {
    if (!KILL_SWITCH_PATTERN.test(key)) continue;
    const parsed = bool.safeParse(raw);
    if (parsed.success) killSwitches[key] = parsed.data;
    else issues.push({ path: [key], message: 'must be a boolean (true/false)' });
  }

  issues.push(...guardrailIssues(env, value));
  if (issues.length > 0) return { issues };
  return { value: { ...value, killSwitches: Object.freeze(killSwitches) } as ServerEnv };
}

/** The full server schema as a Standard Schema, consumed by `@t3-oss/env-core`. */
export const serverSchema: StandardSchemaV1<RawEnv, ServerEnv> = {
  '~standard': {
    version: 1,
    vendor: 'causedeck',
    validate: (input) => validateServerEnv(input as RawEnv),
  },
};
