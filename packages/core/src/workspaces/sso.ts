// Per-organisation SSO providers (#683, part 2 of #508): an owner adds, changes, enables and
// removes the organisation's SAML or OIDC identity provider on `sso_provider`. Owner-only
// (`requireOwner`), audited fail-closed in the caller's transaction as `sso.provider_*` with the
// protocol, domain and enabled flag only. The settings (client secret, certificate) are validated
// by `@causedeck/auth/sso`, stored, and never returned by anything here. Sign-in itself is the
// Better Auth SSO plugin reading the `sso_provider_auth` view (docs/engineering/auth.md).
import { randomUUID } from 'node:crypto';

import { parseSsoConfig, ssoDomainOf, SsoConfigError } from '@causedeck/auth/sso';
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';

import { conflict, invalid, isUniqueViolation, notFound } from './errors.ts';
import { requireOwner } from './members.ts';

type Queryable = Database | Transaction;

const { ssoProvider } = schema;

export type SsoProtocol = typeof ssoProvider.$inferSelect['protocol'];

/** What the settings page may know about a provider: never `config`. */
export interface SsoProviderSummary {
  id: string;
  protocol: SsoProtocol;
  issuer: string;
  domain: string;
  enabled: boolean;
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
  createdAt: ssoProvider.createdAt,
  updatedAt: ssoProvider.updatedAt,
};

/** The organisation's SSO providers, oldest first. Owner only. */
export async function listSsoProviders(
  db: Queryable,
  request: { workspaceId: string; actorUserId: string },
): Promise<SsoProviderSummary[]> {
  const { workspaceId, actorUserId } = request;
  return db.transaction(async (tx) => {
    await requireOwner(tx, workspaceId, actorUserId);
    return tx
      .select(summaryColumns)
      .from(ssoProvider)
      .where(eq(ssoProvider.workspaceId, workspaceId))
      .orderBy(asc(ssoProvider.createdAt), asc(ssoProvider.id));
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
}

/** Add or change a provider. A domain belongs to one provider across all organisations. */
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
          { protocol: request.protocol, issuer, providerId, baseUrl: request.baseUrl },
          request.settings,
        );
      } catch (error) {
        if (error instanceof SsoConfigError) throw invalid(error.message);
        throw error;
      }
    } else if (!existing || existing.protocol !== request.protocol || existing.issuer !== issuer) {
      throw invalid('Enter the provider settings');
    }

    const values = {
      protocol: request.protocol,
      issuer,
      domain,
      enabled: request.enabled,
      ...(config === undefined ? {} : { config }),
    };
    let row: SsoProviderSummary | undefined;
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

    await auditSso(tx, request, existing ? 'sso.provider_updated' : 'sso.provider_created', row);
    return row;
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
    await auditSso(tx, request, 'sso.provider_deleted', row);
  });
}

function auditSso(
  tx: Queryable,
  request: SsoRequestMeta & { workspaceId: string; actorUserId: string },
  action: 'sso.provider_created' | 'sso.provider_updated' | 'sso.provider_deleted',
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
