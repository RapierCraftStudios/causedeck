// Per-organisation SSO (#683, part 2 of #508): the pieces around the Better Auth SSO plugin that
// are ours. The plugin reads providers from the `sso_provider_auth` view (enabled providers only,
// see migration 20261024210000), never writes them: providers are edited through the owner-only
// core service, which validates settings with `parseSsoConfig`. A first SSO sign-in makes the user
// a `viewer` of the organisation; an owner raises the role afterwards. Server-only.
import { schema, withWorkspace, type Database } from '@causedeck/db';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { z } from 'zod';

/**
 * The plugin's read model, `sso_provider_auth` (migration 20261024210000), as a table object: the
 * Drizzle adapter only addresses tables, not views. Column keys are the plugin's field names. It is
 * only ever read; the owner-only core service writes `sso_provider`.
 */
export const ssoProviderAuth = pgTable('sso_provider_auth', {
  id: text('id').notNull(),
  providerId: text('provider_id').notNull(),
  issuer: text('issuer').notNull(),
  domain: text('domain').notNull(),
  oidcConfig: text('oidc_config'),
  samlConfig: text('saml_config'),
  organizationId: text('organization_id').notNull(),
  userId: text('user_id'),
});

/** The role an SSO sign-in gives in the organisation: least privilege, never `owner`. */
export const SSO_DEFAULT_ROLE = 'viewer' as const;

/** Plugin endpoints that may be reached from outside; every other `/sso/*` path is refused. */
const SSO_PUBLIC_PREFIXES = ['/sso/callback', '/sso/saml2/sp/acs/', '/sso/saml2/sp/metadata'];

export function isSsoPath(path: string): boolean {
  return path === '/sign-in/sso' || path.startsWith('/sso/');
}

/**
 * True for plugin endpoints this app does not expose: provider registration, listing, update and
 * delete (providers belong to the owner-only core service) and domain verification.
 */
export function isBlockedSsoPath(path: string): boolean {
  if (!path.startsWith('/sso/')) return false;
  return !SSO_PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The lower-case email domain of an address (or of a bare domain), or null when it is not one. */
export function ssoDomainOf(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const domain = trimmed.includes('@') ? trimmed.slice(trimmed.lastIndexOf('@') + 1) : trimmed;
  return DOMAIN.test(domain) ? domain : null;
}

const https = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), 'must be an https URL');

const OidcInput = z.object({
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().min(1).max(2000),
  /** Defaults to the issuer's `.well-known/openid-configuration`. */
  discoveryEndpoint: https.optional(),
  scopes: z.array(z.string().min(1).max(100)).max(20).optional(),
});

const SamlInput = z.object({
  entryPoint: https,
  /** The identity provider's signing certificate (PEM or base64). */
  cert: z.string().trim().min(1).max(20000),
  audience: z.string().trim().min(1).max(500).optional(),
});

export interface SsoConfigContext {
  protocol: 'saml' | 'oidc';
  issuer: string;
  /** The provider's id: it is part of the SAML assertion consumer URL. */
  providerId: string;
  /** The app origin (`APP_URL`). */
  baseUrl: string;
}

export class SsoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsoConfigError';
  }
}

/**
 * Validate owner-supplied settings and expand them to the plugin's stored `oidcConfig` or
 * `samlConfig` shape (the `sso_provider.config` column). Throws `SsoConfigError`.
 */
export function parseSsoConfig(context: SsoConfigContext, input: unknown): Record<string, unknown> {
  const issuer = context.issuer.trim().replace(/\/+$/, '');
  if (context.protocol === 'oidc') {
    const parsed = OidcInput.safeParse(input);
    if (!parsed.success) throw new SsoConfigError(parsed.error.issues[0]?.message ?? 'Invalid');
    return {
      issuer,
      pkce: true,
      clientId: parsed.data.clientId,
      clientSecret: parsed.data.clientSecret,
      discoveryEndpoint:
        parsed.data.discoveryEndpoint ?? `${issuer}/.well-known/openid-configuration`,
      scopes: parsed.data.scopes ?? ['openid', 'email', 'profile'],
    };
  }
  const parsed = SamlInput.safeParse(input);
  if (!parsed.success) throw new SsoConfigError(parsed.error.issues[0]?.message ?? 'Invalid');
  const { entryPoint, cert, audience } = parsed.data;
  const base = context.baseUrl.replace(/\/+$/, '');
  return {
    issuer,
    entryPoint,
    cert,
    callbackUrl: `${base}/api/auth/sso/saml2/sp/acs/${context.providerId}`,
    ...(audience === undefined ? {} : { audience }),
    wantAssertionsSigned: true,
    idpMetadata: { entityID: issuer, cert },
    spMetadata: {
      entityID: `${base}/api/auth/sso/saml2/sp/metadata?providerId=${context.providerId}`,
    },
  };
}

/** Add the user to the organisation as `SSO_DEFAULT_ROLE`; an existing membership is untouched. */
export async function provisionSsoMember(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await withWorkspace(db, { workspaceId, userId }, async (tx) => {
    await tx
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId, role: SSO_DEFAULT_ROLE })
      .onConflictDoNothing();
  });
}
