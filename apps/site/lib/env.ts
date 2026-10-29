// Build-time env for the static site (spike §3.3). Everything is public and inlined at build time;
// the site holds no secrets. An invalid value fails the build instead of shipping a broken URL.
import { z } from 'zod';

const httpsUrl = z
  .url()
  .refine((value) => value.startsWith('https://') || value.startsWith('http://localhost'), {
    message: 'must be an https URL',
  })
  .transform((value) => value.replace(/\/+$/, ''));

/** The status snapshot: root-relative (same origin) or an absolute https URL; no trailing-slash trimming. */
const statusUrl = z
  .string()
  .refine(
    (value) =>
      (value.startsWith('/') && !value.startsWith('//')) ||
      value.startsWith('https://') ||
      value.startsWith('http://localhost'),
    { message: 'must be root-relative or an https URL' },
  );

/** Public development key of the snapshot signature (`DEV_STATUS_SIGNING_KEY` in @causedeck/config). */
export const DEV_STATUS_VERIFY_KEY = 'dev-only-insecure-status-signing-key-change-me';

export const siteEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: httpsUrl.default('https://causedeck.example'),
  NEXT_PUBLIC_APP_URL: httpsUrl.default('https://app.causedeck.example'),
  /** Cookie-less analytics script, off unless set (PX-6). */
  NEXT_PUBLIC_ANALYTICS_SRC: httpsUrl.optional(),
  NEXT_PUBLIC_STATUS_URL: statusUrl.default('/status/status.json'),
  /** Public by design: detects corruption of status.json, not a forger who can read this key. */
  NEXT_PUBLIC_STATUS_VERIFY_KEY: z.string().min(1).default(DEV_STATUS_VERIFY_KEY),
});

export interface SiteEnv {
  siteUrl: string;
  appUrl: string;
  /** False when NEXT_PUBLIC_APP_URL was not provided and `appUrl` is only the default. */
  appUrlConfigured: boolean;
  analyticsSrc: string | undefined;
  statusUrl: string;
  statusVerifyKey: string;
}

/** Empty strings count as unset so a blank CI variable falls back to the default. */
export function readSiteEnv(raw: Record<string, string | undefined>): SiteEnv {
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
  const parsed = siteEnvSchema.parse(cleaned);
  return {
    siteUrl: parsed.NEXT_PUBLIC_SITE_URL,
    appUrl: parsed.NEXT_PUBLIC_APP_URL,
    appUrlConfigured: cleaned.NEXT_PUBLIC_APP_URL !== undefined,
    analyticsSrc: parsed.NEXT_PUBLIC_ANALYTICS_SRC,
    statusUrl: parsed.NEXT_PUBLIC_STATUS_URL,
    statusVerifyKey: parsed.NEXT_PUBLIC_STATUS_VERIFY_KEY,
  };
}

// Next.js inlines `process.env.NEXT_PUBLIC_*` only when each name is written out literally.
/* eslint-disable no-process-env -- the site's single env boundary. */
export const siteEnv: SiteEnv = readSiteEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_ANALYTICS_SRC: process.env.NEXT_PUBLIC_ANALYTICS_SRC,
  NEXT_PUBLIC_STATUS_URL: process.env.NEXT_PUBLIC_STATUS_URL,
  NEXT_PUBLIC_STATUS_VERIFY_KEY: process.env.NEXT_PUBLIC_STATUS_VERIFY_KEY,
});
/* eslint-enable no-process-env */
