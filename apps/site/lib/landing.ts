// Landing page helpers (#90): where the primary CTA points.
import { siteEnv } from './env.ts';

/** `https://app.<tld>/sign-in`, or the mailto `/contact/` page when no app URL is configured. */
export function signInHref(
  appUrl: string = siteEnv.appUrl,
  configured: boolean = siteEnv.appUrlConfigured,
): string {
  return configured ? `${appUrl}/sign-in` : '/contact/';
}

/** Contact address on the site's own domain; the contact page is a single mailto link. */
export function contactEmail(siteUrl: string = siteEnv.siteUrl): string {
  return `hello@${new URL(siteUrl).hostname}`;
}
