// Per-organisation SSO (#683, part 2 of #508): the pieces around the Better Auth SSO plugin that
// are ours. The plugin reads providers through `app_sso_provider_lookup` (one enabled provider per exact id or
// domain, see migration 20261025020100), never writes them: providers are edited through the owner-only
// core service, which validates settings with `parseSsoConfig`. A first SSO sign-in makes the user
// a `viewer` of the organisation; an owner raises the role afterwards. Server-only.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { schema, withWorkspace, type Database } from '@causedeck/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

type Where = { field: string; value?: unknown }[] | undefined;

type LookupRow = {
  id: string;
  issuer: string;
  domain: string;
  oidc_config: string | null;
  saml_config: string | null;
  organization_id: string;
  user_id: string | null;
};

/**
 * Wrap the Better Auth database adapter so the SSO plugin's `ssoProvider` model is answered by the
 * keyed definer function `app_sso_provider_lookup` (migration 20261025020100) instead of a table
 * read: one enabled provider for an exact provider id or domain, nothing else. Listing,
 * enumeration by organisation and every write are refused (empty or no-op), so the app role can
 * never read another tenant's providers or settings in bulk.
 */
export function withSsoProviderLookup<A extends object>(
  db: Database,
  secret: string,
  factory: (options: never) => A,
): (options: never) => A {
  const wrap = (base: Record<string, unknown>): Record<string, unknown> => {
    const isSso = (args: unknown) => (args as { model?: string }).model === 'ssoProvider';
    const lookup = async (where: Where) => {
      const value = (field: string) => {
        const v = where?.find((w) => w.field === field)?.value;
        return typeof v === 'string' ? v : null;
      };
      const providerId = value('providerId') ?? value('id');
      const domain = value('domain');
      if (providerId === null && domain === null) return null;
      const rows = await db.execute<LookupRow>(
        sql`select * from app_sso_provider_lookup(${providerId}, ${domain})`,
      );
      const row = rows[0];
      if (!row) return null;
      // The stored client secret is sealed; the plugin gets it in the clear only here, for one
      // sign-in. A row that does not open (wrong key, tampering) is treated as no provider.
      let oidcConfig = row.oidc_config;
      if (oidcConfig !== null) {
        try {
          oidcConfig = openSsoConfig(secret, row.organization_id, row.id, oidcConfig);
        } catch {
          return null;
        }
      }
      return {
        id: row.id,
        providerId: row.id,
        issuer: row.issuer,
        domain: row.domain,
        oidcConfig,
        samlConfig: row.saml_config,
        organizationId: row.organization_id,
        userId: row.user_id,
        // `app_sso_provider_lookup` returns only providers whose domain passed DNS verification.
        domainVerified: true,
      };
    };
    const wrapped: Record<string, unknown> = {
      ...base,
      findOne: (args: { where?: Where }) =>
        isSso(args) ? lookup(args.where) : (base.findOne as (a: unknown) => unknown)(args),
      findMany: (args: unknown) =>
        isSso(args) ? Promise.resolve([]) : (base.findMany as (a: unknown) => unknown)(args),
      create: (args: unknown) =>
        isSso(args)
          ? Promise.reject(new Error('sso providers are managed by the core service'))
          : (base.create as (a: unknown) => unknown)(args),
      // The plugin "locks" a provider with a no-change update before linking an account.
      update: (args: { where?: Where }) =>
        isSso(args) ? lookup(args.where) : (base.update as (a: unknown) => unknown)(args),
      updateMany: (args: unknown) =>
        isSso(args) ? Promise.resolve(0) : (base.updateMany as (a: unknown) => unknown)(args),
      delete: (args: unknown) =>
        isSso(args) ? Promise.resolve() : (base.delete as (a: unknown) => unknown)(args),
      deleteMany: (args: unknown) =>
        isSso(args) ? Promise.resolve(0) : (base.deleteMany as (a: unknown) => unknown)(args),
    };
    if (typeof base.incrementOne === 'function') {
      wrapped.incrementOne = (args: unknown) =>
        isSso(args) ? Promise.resolve(true) : (base.incrementOne as (a: unknown) => unknown)(args);
    }
    if (typeof base.transaction === 'function') {
      wrapped.transaction = (callback: (trx: Record<string, unknown>) => unknown) =>
        (base.transaction as (cb: (trx: Record<string, unknown>) => unknown) => unknown)((trx) =>
          callback(wrap(trx)),
        );
    }
    return wrapped;
  };
  return (options) => wrap(factory(options) as Record<string, unknown>) as A;
}

const SEALED_PREFIX = 's1.';

function sealingKey(secret: string, workspaceId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', secret, 'causedeck:sso-config:v1', `workspace:${workspaceId}`, 32),
  );
}

/** Seal a client secret: AES-256-GCM, key derived from the auth secret, bound to workspace and provider. */
export function sealSsoSecret(
  secret: string,
  workspaceId: string,
  providerId: string,
  plaintext: string,
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealingKey(secret, workspaceId), nonce);
  cipher.setAAD(Buffer.from(`${workspaceId}:${providerId}`));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return SEALED_PREFIX + Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url');
}

export function openSsoSecret(
  secret: string,
  workspaceId: string,
  providerId: string,
  sealed: string,
): string {
  if (!sealed.startsWith(SEALED_PREFIX)) throw new Error('not a sealed secret');
  const bytes = Buffer.from(sealed.slice(SEALED_PREFIX.length), 'base64url');
  if (bytes.length < 12 + 16) throw new Error('sealed secret is too short');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    sealingKey(secret, workspaceId),
    bytes.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(`${workspaceId}:${providerId}`));
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return Buffer.concat([
    decipher.update(bytes.subarray(12, bytes.length - 16)),
    decipher.final(),
  ]).toString('utf8');
}

/** Replace the sealed `clientSecret` of a stored OIDC config (JSON text) with its plaintext. */
function openSsoConfig(secret: string, workspaceId: string, providerId: string, json: string) {
  const config = JSON.parse(json) as Record<string, unknown>;
  if (typeof config.clientSecret === 'string') {
    config.clientSecret = openSsoSecret(secret, workspaceId, providerId, config.clientSecret);
  }
  return JSON.stringify(config);
}

/**
 * True when an IdP-asserted email belongs to the provider's verified domain (the domain itself or
 * a subdomain). The one rule behind both account linking and first sign-in.
 */
export function emailMatchesDomain(email: string, domain: string): boolean {
  const asserted = ssoDomainOf(email.includes('@') ? email : '');
  const bound = domain.trim().toLowerCase();
  return asserted !== null && (asserted === bound || asserted.endsWith(`.${bound}`));
}

/** True for the plugin's two sign-in return paths (OIDC callback, SAML assertion consumer). */
export function isSsoReturnPath(path: string | undefined): boolean {
  return (
    path !== undefined &&
    (path.startsWith('/sso/callback') || path.startsWith('/sso/saml2/sp/acs/'))
  );
}

/**
 * The takeover guard. On an SSO return, the account being created or linked must carry an email at
 * the domain this organisation's provider has verified; otherwise a provider (or a forged
 * assertion) could mint or capture an account at another organisation's, or a personal, address.
 * Returns false when the provider is unknown or the email is outside its domain.
 */
export async function ssoEmailAllowed(
  db: Database,
  providerId: string | undefined,
  email: string,
): Promise<boolean> {
  if (providerId === undefined) return false;
  const rows = await db.execute<LookupRow>(
    sql`select * from app_sso_provider_lookup(${providerId}, null)`,
  );
  const row = rows[0];
  return row !== undefined && emailMatchesDomain(email, row.domain);
}

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

const https = z.url().refine((value) => value.startsWith('https://'), 'must be an https URL');

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
  /** The organisation that owns the provider; binds a sealed client secret to it. */
  workspaceId: string;
  /** The auth secret (`BETTER_AUTH_SECRET`) the client secret is sealed with. */
  sealingSecret: string;
}

export class SsoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsoConfigError';
  }
}

/**
 * Validate owner-supplied settings and expand them to the plugin's stored `oidcConfig` or
 * `samlConfig` shape (the `sso_provider.config` column), with the OIDC client secret sealed.
 * Throws `SsoConfigError`.
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
      clientSecret: sealSsoSecret(
        context.sealingSecret,
        context.workspaceId,
        context.providerId,
        parsed.data.clientSecret,
      ),
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
