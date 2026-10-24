// Browser auth client (#152). Safe for client components: no server modules, no secrets.
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import {
  magicLinkClient,
  organizationClient,
  phoneNumberClient,
  twoFactorClient,
} from 'better-auth/client/plugins';

import { ac, roles } from './roles';

export function createCauseDeckAuthClient(options: { baseURL?: string } = {}) {
  return createAuthClient({
    ...options,
    plugins: [
      organizationClient({ ac, roles }),
      passkeyClient(),
      magicLinkClient(),
      phoneNumberClient(),
      twoFactorClient(),
    ],
  });
}

export type AuthClient = ReturnType<typeof createCauseDeckAuthClient>;
