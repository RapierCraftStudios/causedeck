// The signup channel carrier (#703 R9): the web proxy stores a valid `?channel=` from /sign-in in a
// short-lived httpOnly cookie, and the user.create hook reads it back, because magic-link, OAuth
// and phone-OTP flows create the user in a later request that carries no query or body. Only a
// member of the closed activation channel list is ever stored or recorded: no module slug, no
// campaign detail, no free text. Imports no database client, so the proxy can use it.
import { ACTIVATION_CHANNELS, type ActivationChannel } from '@causedeck/db/schema';

export const SIGNUP_CHANNEL_COOKIE = 'cd_channel';

/** Long enough to finish a magic-link round trip, short enough not to label a later signup. */
export const SIGNUP_CHANNEL_MAX_AGE_SECONDS = 60 * 60;

/** The value when it is exactly one of the closed channels, else `null`. */
export function parseSignupChannel(value: string | null | undefined): ActivationChannel | null {
  if (value === null || value === undefined) return null;
  return (ACTIVATION_CHANNELS as readonly string[]).includes(value)
    ? (value as ActivationChannel)
    : null;
}

/** The validated channel in a `Cookie` request header, or `null`. */
export function signupChannelFromCookieHeader(
  header: string | null | undefined,
): ActivationChannel | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === SIGNUP_CHANNEL_COOKIE) {
      return parseSignupChannel(part.slice(at + 1).trim());
    }
  }
  return null;
}
