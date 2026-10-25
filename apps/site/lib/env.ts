// Build-time env for the static site (spike §3.3). Everything is public and inlined at build time;
// the site holds no secrets. An invalid value fails the build instead of shipping a broken URL.
import { z } from 'zod';

const httpsUrl = z
  .url()
  .refine((value) => value.startsWith('https://') || value.startsWith('http://localhost'), {
    message: 'must be an https URL',
  })
  .transform((value) => value.replace(/\/+$/, ''));

export const siteEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: httpsUrl.default('https://causedeck.example'),
  NEXT_PUBLIC_APP_URL: httpsUrl.default('https://app.causedeck.example'),
  /** Cookie-less analytics script, off unless set (PX-6). */
  NEXT_PUBLIC_ANALYTICS_SRC: httpsUrl.optional(),
});

export interface SiteEnv {
  siteUrl: string;
  appUrl: string;
  /** False when NEXT_PUBLIC_APP_URL was not provided and `appUrl` is only the default. */
  appUrlConfigured: boolean;
  analyticsSrc: string | undefined;
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
  };
}

// Next.js inlines `process.env.NEXT_PUBLIC_*` only when each name is written out literally.
/* eslint-disable no-process-env -- the site's single env boundary. */
export const siteEnv: SiteEnv = readSiteEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_ANALYTICS_SRC: process.env.NEXT_PUBLIC_ANALYTICS_SRC,
});
/* eslint-enable no-process-env */
