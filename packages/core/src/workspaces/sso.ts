// Per-organisation SSO providers (#683, part 2 of #508): an owner adds, changes, enables and
// removes the organisation's SAML or OIDC identity provider on `sso_provider`. Owner-only
// (`requireOwner`), audited fail-closed in the caller's transaction as `sso.provider_*` with the
// protocol, domain and enabled flag only. The settings (client secret, certificate) are validated
// by `@causedeck/auth/sso`, stored, and never returned by anything here. Sign-in itself is the
// Better Auth SSO plugin reading `app_sso_provider_lookup` (docs/engineering/auth.md).
import { randomBytes, randomUUID } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';

import { parseSsoConfig, ssoDomainOf, SsoConfigError } from '@causedeck/auth/sso';
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';

import { conflict, invalid, isUniqueViolation, notFound } from './errors.ts';
import { requireOwner } from './members.ts';

type Queryable = Database | Transaction;

const { ssoProvider } = schema;

export type SsoProtocol = (typeof ssoProvider.$inferSelect)['protocol'];

/** What the settings page may know about a provider: never `config`. */
export interface SsoProviderSummary {
  id: string;
  protocol: SsoProtocol;
  issuer: string;
  domain: string;
  enabled: boolean;
  /** True once the DNS TXT proof of the domain was seen; only then can the provider be enabled. */
  domainVerified: boolean;
  /**
   * The DNS TXT record the owner publishes to prove the domain, while it is unverified. The token
   * is a public proof value, not a credential.
   */
  domainVerification: { name: string; value: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SsoRequestMeta {
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

const summaryColumns = {
  id: ssoProvider.id,
  protocol: ssoProvider.protocol,
  issuer: ssoProvider.issuer,
  domain: ssoProvider.domain,
  enabled: ssoProvider.enabled,
  domainVerifiedAt: ssoProvider.domainVerifiedAt,
  domainVerificationToken: ssoProvider.domainVerificationToken,
  createdAt: ssoProvider.createdAt,
  updatedAt: ssoProvider.updatedAt,
};

type SummaryRow = Pick<
  typeof ssoProvider.$inferSelect,
  | 'id'
  | 'protocol'
  | 'issuer'
  | 'domain'
  | 'enabled'
  | 'domainVerifiedAt'
  | 'domainVerificationToken'
  | 'createdAt'
  | 'updatedAt'
>;

/** The TXT label (the plugin's `_better-auth-token-<providerId>` convention) and value. */
function ssoVerificationRecord(
  providerId: string,
  domain: string,
  token: string,
): { name: string; value: string } {
  const label = `_better-auth-token-${providerId}`;
  return { name: `${label}.${domain}`, value: `${label}=${token}` };
}

function toSummary(row: SummaryRow): SsoProviderSummary {
  const verified = row.domainVerifiedAt !== null;
  return {
    id: row.id,
    protocol: row.protocol,
    issuer: row.issuer,
    domain: row.domain,
    enabled: row.enabled,
    domainVerified: verified,
    domainVerification:
      verified || row.domainVerificationToken === null
        ? null
        : ssoVerificationRecord(row.id, row.domain, row.domainVerificationToken),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The organisation's SSO providers, oldest first. Owner only. */
export async function listSsoProviders(
  db: Queryable,
  request: { workspaceId: string; actorUserId: string },
): Promise<SsoProviderSummary[]> {
  const { workspaceId, actorUserId } = request;
  return db.transaction(async (tx) => {
    await requireOwner(tx, workspaceId, actorUserId);
    const rows = await tx
      .select(summaryColumns)
      .from(ssoProvider)
      .where(eq(ssoProvider.workspaceId, workspaceId))
      .orderBy(asc(ssoProvider.createdAt), asc(ssoProvider.id));
    return rows.map(toSummary);
  });
}

export interface SaveSsoProviderRequest extends SsoRequestMeta {
  workspaceId: string;
  actorUserId: string;
  /** Present to change a provider; absent to add one. */
  providerId?: string;
  protocol: SsoProtocol;
  issuer: string;
  /** The email domain that signs in through this provider. */
  domain: string;
  /** Protocol settings; optional on a change that keeps the stored ones. */
  settings?: unknown;
  enabled: boolean;
  /** The app origin, for the SAML assertion consumer URL. */
  baseUrl: string;
  /** `BETTER_AUTH_SECRET`: the OIDC client secret is sealed with a key derived from it. */
  sealingSecret: string;
}

/** Add or change a provider. A domain is bound to the one organisation that proves it
 * (DNS TXT, `verifySsoDomain`): a provider cannot be enabled before that, and changing the domain
 * drops the proof. Nothing signs in through an unverified provider. */
export async function saveSsoProvider(
  db: Queryable,
  request: SaveSsoProviderRequest,
): Promise<SsoProviderSummary> {
  const { workspaceId, actorUserId } = request;
  const domain = ssoDomainOf(request.domain);
  if (domain === null || request.domain.includes('@')) throw invalid('Enter an email domain');
  const issuer = request.issuer.trim();
  if (issuer.length === 0 || issuer.length > 500) throw invalid('Enter the issuer');

  return db.transaction(async (tx) => {
    await requireOwner(tx, workspaceId, actorUserId);
    const [existing] =
      request.providerId === undefined
        ? []
        : await tx
            .select({
              id: ssoProvider.id,
              protocol: ssoProvider.protocol,
              issuer: ssoProvider.issuer,
              domain: ssoProvider.domain,
              verifiedAt: ssoProvider.domainVerifiedAt,
            })
            .from(ssoProvider)
            .where(
              and(eq(ssoProvider.id, request.providerId), eq(ssoProvider.workspaceId, workspaceId)),
            )
            .for('update');
    if (request.providerId !== undefined && !existing) throw notFound();

    const providerId = existing?.id ?? randomUUID();
    let config: Record<string, unknown> | undefined;
    if (request.settings !== undefined) {
      try {
        config = parseSsoConfig(
          {
            protocol: request.protocol,
            issuer,
            providerId,
            baseUrl: request.baseUrl,
            workspaceId,
            sealingSecret: request.sealingSecret,
          },
          request.settings,
        );
      } catch (error) {
        if (error instanceof SsoConfigError) throw invalid(error.message);
        throw error;
      }
    } else if (!existing || existing.protocol !== request.protocol || existing.issuer !== issuer) {
      throw invalid('Enter the provider settings');
    }

    // The proof belongs to the domain it was published for; a new domain starts unverified.
    const sameDomain = existing?.domain === domain;
    const verified = sameDomain && existing.verifiedAt !== null;
    if (request.enabled && !verified) throw invalid('Verify the domain before enabling SSO');
    const values = {
      protocol: request.protocol,
      issuer,
      domain,
      enabled: request.enabled,
      ...(config === undefined ? {} : { config }),
      ...(sameDomain
        ? {}
        : {
            domainVerifiedAt: null,
            domainVerificationToken: randomBytes(24).toString('base64url'),
          }),
    };
    let row: SummaryRow | undefined;
    try {
      // A savepoint, so a duplicate domain leaves the outer transaction usable.
      row = await tx.transaction(async (inner) => {
        const [saved] = existing
          ? await inner
              .update(ssoProvider)
              .set({ ...values, updatedAt: new Date() })
              .where(and(eq(ssoProvider.id, providerId), eq(ssoProvider.workspaceId, workspaceId)))
              .returning(summaryColumns)
          : await inner
              .insert(ssoProvider)
              .values({
                id: providerId,
                workspaceId,
                createdBy: actorUserId,
                ...values,
                domainVerificationToken: randomBytes(24).toString('base64url'),
                config: config ?? {},
              })
              .returning(summaryColumns);
        return saved;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'sso_provider_domain_uq')) {
        throw conflict('That domain already has an SSO provider');
      }
      throw error;
    }
    if (!row) throw notFound();

    const summary = toSummary(row);
    await auditSso(
      tx,
      request,
      existing ? 'sso.provider_updated' : 'sso.provider_created',
      summary,
    );
    return summary;
  });
}

/** Looks up TXT records; injectable so tests need no DNS. */
export type TxtResolver = (name: string) => Promise<string[][]>;

/**
 * Prove the organisation controls the provider's domain: the owner published the TXT record
 * `ssoVerificationRecord` returns, and we see it. Only then is the domain bound to this
 * organisation (a domain verified elsewhere is refused) and the provider can be enabled.
 */
export async function verifySsoDomain(
  db: Queryable,
  request: SsoRequestMeta & {
    workspaceId: string;
    actorUserId: string;
    providerId: string;
    resolver?: TxtResolver;
  },
): Promise<SsoProviderSummary> {
  const { workspaceId, actorUserId, providerId } = request;
  const lookup = request.resolver ?? resolveTxt;
  return db.transaction(async (tx) => {
    await requireOwner(tx, workspaceId, actorUserId);
    const [row] = await tx
      .select(summaryColumns)
      .from(ssoProvider)
      .where(and(eq(ssoProvider.id, providerId), eq(ssoProvider.workspaceId, workspaceId)))
      .for('update');
    if (!row) throw notFound();
    if (row.domainVerifiedAt !== null) return toSummary(row);
    if (row.domainVerificationToken === null) throw invalid('Domain verification is not set up');
    const expected = ssoVerificationRecord(row.id, row.domain, row.domainVerificationToken);
    let records: string[][] = [];
    try {
      records = await lookup(expected.name);
    } catch {
      // No record (NXDOMAIN, timeout): the same answer as a wrong record.
    }
    const found = records.some((chunks) => {
      const text = chunks.join('').trim();
      return text === expected.value || text === row.domainVerificationToken;
    });
    if (!found) throw invalid('We could not find the DNS record yet. Check it and try again.');
    let verified: SummaryRow | undefined;
    try {
      [verified] = await tx.transaction((inner) =>
        inner
          .update(ssoProvider)
          .set({ domainVerifiedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(ssoProvider.id, providerId), eq(ssoProvider.workspaceId, workspaceId)))
          .returning(summaryColumns),
      );
    } catch (error) {
      if (isUniqueViolation(error, 'sso_provider_domain_uq')) {
        throw conflict('That domain is already verified by another organisation');
      }
      throw error;
    }
    if (!verified) throw notFound();
    const summary = toSummary(verified);
    await auditSso(tx, request, 'sso.domain_verified', summary);
    return summary;
  });
}

/** Remove a provider; its users keep their accounts and memberships. */
export async function deleteSsoProvider(
  db: Queryable,
  request: SsoRequestMeta & { workspaceId: string; actorUserId: string; providerId: string },
): Promise<void> {
  const { workspaceId, actorUserId, providerId } = request;
  await db.transaction(async (tx) => {
    await requireOwner(tx, workspaceId, actorUserId);
    const [row] = await tx
      .delete(ssoProvider)
      .where(and(eq(ssoProvider.id, providerId), eq(ssoProvider.workspaceId, workspaceId)))
      .returning(summaryColumns);
    if (!row) throw notFound();
    await auditSso(tx, request, 'sso.provider_deleted', toSummary(row));
  });
}

function auditSso(
  tx: Queryable,
  request: SsoRequestMeta & { workspaceId: string; actorUserId: string },
  action:
    | 'sso.provider_created'
    | 'sso.provider_updated'
    | 'sso.provider_deleted'
    | 'sso.domain_verified',
  row: SsoProviderSummary,
): Promise<void> {
  return record(
    {
      db: tx,
      workspaceId: request.workspaceId,
      actor: { userId: request.actorUserId, kind: 'user' as const },
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.userAgent === undefined ? {} : { userAgent: request.userAgent }),
      ...(request.ip === undefined ? {} : { ip: request.ip }),
    },
    {
      action,
      target: { kind: 'sso_provider', id: row.id },
      metadata: { protocol: row.protocol, domain: row.domain, enabled: row.enabled },
    },
  );
}
