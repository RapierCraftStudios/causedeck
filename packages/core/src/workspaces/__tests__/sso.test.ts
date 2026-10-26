// SSO providers (#683) against a real Postgres: owner-only, the client secret is sealed and never
// returned, a domain is bound to the organisation that proves it by DNS, and every change is audited.
import { randomUUID } from 'node:crypto';

import { openSsoSecret } from '@causedeck/auth/sso';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createWorkspace,
  deleteSsoProvider,
  listSsoProviders,
  saveSsoProvider,
  verifySsoDomain,
  WorkspaceError,
  type TxtResolver,
  type WorkspaceRole,
} from '../index.ts';

const SEAL = 'test-sealing-secret-test-sealing-secret';
const BASE = 'https://app.example.com';

async function newUser(tx: Transaction): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: 'Member', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

async function setup(tx: Transaction) {
  const ownerId = await newUser(tx);
  const workspace = await createWorkspace(tx, {
    userId: ownerId,
    input: { name: `Sso ${randomUUID().slice(0, 8)}` },
  });
  return { ownerId, workspaceId: workspace.id };
}

async function addMember(tx: Transaction, workspaceId: string, role: WorkspaceRole) {
  const userId = await newUser(tx);
  await inWorkspace(tx, workspaceId, (s) =>
    s.insert(schema.member).values({ organizationId: workspaceId, userId, role }),
  );
  return userId;
}

const domainOf = () => `firm-${randomUUID().slice(0, 8)}.example.com`;

const save = (
  tx: Transaction,
  workspaceId: string,
  actorUserId: string,
  extra: Partial<Parameters<typeof saveSsoProvider>[1]> = {},
) =>
  inWorkspace(tx, workspaceId, (s) =>
    saveSsoProvider(s, {
      workspaceId,
      actorUserId,
      protocol: 'oidc',
      issuer: 'https://idp.example.com',
      domain: domainOf(),
      enabled: false,
      settings: { clientId: 'client', clientSecret: 'super-secret-value' },
      baseUrl: BASE,
      sealingSecret: SEAL,
      ...extra,
    }),
  );

const verify = (
  tx: Transaction,
  workspaceId: string,
  actorUserId: string,
  providerId: string,
  resolver: TxtResolver,
) =>
  inWorkspace(tx, workspaceId, (s) =>
    verifySsoDomain(s, { workspaceId, actorUserId, providerId, resolver }),
  );

/** A resolver that publishes the record the provider asked for. */
const publishing =
  (record: { name: string; value: string } | null): TxtResolver =>
  (name) =>
    record !== null && name === record.name
      ? Promise.resolve([[record.value]])
      : Promise.reject(new Error('ENOTFOUND'));

async function expectCode(promise: Promise<unknown>, code: string) {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  expect((error as WorkspaceError).code).toBe(code);
}

const auditActions = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, async (s) => {
    const rows = await s
      .select({ action: schema.auditEvent.action, metadata: schema.auditEvent.metadata })
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.workspaceId, workspaceId)));
    return rows.filter((r) => r.action.startsWith('sso.'));
  });

describe('SSO providers', () => {
  it('lets only an owner configure SSO', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const admin = await addMember(tx, workspaceId, 'advocate');
      const advocate = await addMember(tx, workspaceId, 'viewer');
      for (const actor of [admin, advocate]) {
        await expectCode(save(tx, workspaceId, actor), 'FORBIDDEN');
        await expectCode(
          inWorkspace(tx, workspaceId, (s) =>
            listSsoProviders(s, { workspaceId, actorUserId: actor }),
          ),
          'FORBIDDEN',
        );
      }
      const row = await save(tx, workspaceId, ownerId);
      await expectCode(
        inWorkspace(tx, workspaceId, (s) =>
          deleteSsoProvider(s, { workspaceId, actorUserId: admin, providerId: row.id }),
        ),
        'FORBIDDEN',
      );
      await expectCode(
        verify(tx, workspaceId, admin, row.id, publishing(row.domainVerification)),
        'FORBIDDEN',
      );
    });
  });

  it('seals the client secret, never returns it, and keeps it out of the audit row', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const row = await save(tx, workspaceId, ownerId);
      const listed = await inWorkspace(tx, workspaceId, (s) =>
        listSsoProviders(s, { workspaceId, actorUserId: ownerId }),
      );
      expect(JSON.stringify([row, listed])).not.toContain('super-secret-value');
      expect(JSON.stringify([row, listed])).not.toContain('sealed');
      expect(Object.keys(row)).not.toContain('config');

      const [stored] = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select({ config: schema.ssoProvider.config })
          .from(schema.ssoProvider)
          .where(eq(schema.ssoProvider.id, row.id)),
      );
      const sealed = String(stored?.config.clientSecret);
      expect(JSON.stringify(stored)).not.toContain('super-secret-value');
      expect(openSsoSecret(SEAL, workspaceId, row.id, sealed)).toBe('super-secret-value');
      expect(JSON.stringify(await auditActions(tx, workspaceId))).not.toContain('secret');
    });
  });

  it('cannot enable a provider before its domain is verified, and verifies only by DNS', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      await expectCode(save(tx, workspaceId, ownerId, { enabled: true }), 'VALIDATION');
      const row = await save(tx, workspaceId, ownerId);
      expect(row.domainVerified).toBe(false);
      expect(row.domainVerification?.name).toBe(`_better-auth-token-${row.id}.${row.domain}`);

      // No record, a wrong record, and a record for another provider all fail the same way.
      await expectCode(verify(tx, workspaceId, ownerId, row.id, publishing(null)), 'VALIDATION');
      await expectCode(
        verify(
          tx,
          workspaceId,
          ownerId,
          row.id,
          publishing({
            name: row.domainVerification?.name ?? '',
            value: 'wrong',
          }),
        ),
        'VALIDATION',
      );
      await expectCode(
        inWorkspace(tx, workspaceId, (s) =>
          saveSsoProvider(s, {
            workspaceId,
            actorUserId: ownerId,
            providerId: row.id,
            protocol: 'oidc',
            issuer: 'https://idp.example.com',
            domain: row.domain,
            enabled: true,
            baseUrl: BASE,
            sealingSecret: SEAL,
          }),
        ),
        'VALIDATION',
      );

      const verified = await verify(
        tx,
        workspaceId,
        ownerId,
        row.id,
        publishing(row.domainVerification),
      );
      expect(verified).toMatchObject({ domainVerified: true, domainVerification: null });
      const enabled = await inWorkspace(tx, workspaceId, (s) =>
        saveSsoProvider(s, {
          workspaceId,
          actorUserId: ownerId,
          providerId: row.id,
          protocol: 'oidc',
          issuer: 'https://idp.example.com',
          domain: row.domain,
          enabled: true,
          baseUrl: BASE,
          sealingSecret: SEAL,
        }),
      );
      expect(enabled).toMatchObject({ enabled: true, domainVerified: true });

      // Changing the domain drops the proof and the provider must be switched off again.
      await expectCode(
        inWorkspace(tx, workspaceId, (s) =>
          saveSsoProvider(s, {
            workspaceId,
            actorUserId: ownerId,
            providerId: row.id,
            protocol: 'oidc',
            issuer: 'https://idp.example.com',
            domain: domainOf(),
            enabled: true,
            baseUrl: BASE,
            sealingSecret: SEAL,
          }),
        ),
        'VALIDATION',
      );
    });
  });

  it('binds a domain to the one organisation that proves it', async () => {
    await withTestDb(async (tx) => {
      const a = await setup(tx);
      const b = await setup(tx);
      const domain = domainOf();
      // Both may claim it; neither is verified, so neither blocks the other.
      const claimA = await save(tx, a.workspaceId, a.ownerId, { domain });
      const claimB = await save(tx, b.workspaceId, b.ownerId, { domain });
      // A cannot verify with B's token: the record is per provider and per token.
      await expectCode(
        verify(tx, a.workspaceId, a.ownerId, claimA.id, publishing(claimB.domainVerification)),
        'VALIDATION',
      );
      await verify(tx, b.workspaceId, b.ownerId, claimB.id, publishing(claimB.domainVerification));
      // Once B proved it, A can no longer verify the same domain, even with a valid record.
      await expectCode(
        verify(tx, a.workspaceId, a.ownerId, claimA.id, publishing(claimA.domainVerification)),
        'CONFLICT',
      );
    });
  });

  it('audits create, update, verify and delete without the settings', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const row = await save(tx, workspaceId, ownerId);
      await save(tx, workspaceId, ownerId, {
        providerId: row.id,
        domain: row.domain,
        settings: undefined,
      });
      await verify(tx, workspaceId, ownerId, row.id, publishing(row.domainVerification));
      await inWorkspace(tx, workspaceId, (s) =>
        deleteSsoProvider(s, { workspaceId, actorUserId: ownerId, providerId: row.id }),
      );
      const events = await auditActions(tx, workspaceId);
      expect(events.map((e) => e.action)).toEqual([
        'sso.provider_created',
        'sso.provider_updated',
        'sso.domain_verified',
        'sso.provider_deleted',
      ]);
      for (const event of events) {
        expect(Object.keys(event.metadata).sort()).toEqual(['domain', 'enabled', 'protocol']);
      }
    });
  });
});
