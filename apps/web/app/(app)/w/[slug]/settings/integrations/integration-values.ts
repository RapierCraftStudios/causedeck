// The values the integrations cards show (#287): the private ICS feed URL
// `<APP_URL origin>/api/ics/<token>` (the endpoint the Capture milestone builds, #53) and its
// masked placeholder. Pure, so the server page, the server action and the client card share them;
// the plaintext token only ever passes through `icsFeedUrl` once, in the rotate action's result.
// The email intake address is per member and lives on the email page (#54).
import type { FlagKey } from '@causedeck/flags/keys';
import type { IntegrationKindValue } from '@causedeck/validators/workspace';

export type IntegrationKind = IntegrationKindValue;

/** Each card's feature flag: the card reads `Not enabled yet` and cannot rotate until it is on. */
export const INTEGRATION_FLAGS: Readonly<Record<IntegrationKind, FlagKey>> = {
  ics_feed: 'capture.ics-feed',
};

/** Stands in for a token that is never shown again. */
export const MASK = '••••••••';

export function icsFeedUrl(token: string, appUrl: string): string {
  return `${new URL(appUrl).origin}/api/ics/${token}`;
}

/** The kind's display value for `token` (the plaintext, once) or the masked placeholder. */
export function integrationValue(_kind: IntegrationKind, token: string, appUrl: string): string {
  return icsFeedUrl(token, appUrl);
}

export function maskedIntegrationValue(kind: IntegrationKind, appUrl: string): string {
  return integrationValue(kind, MASK, appUrl);
}
