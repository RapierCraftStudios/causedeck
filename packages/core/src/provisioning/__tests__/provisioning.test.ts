// Bulk seat provisioning (#684): CSV runs (100 rows, dry run, bad rows) and SCIM tokens and Users.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  authenticateScimToken,
  createScimToken,
  handleScim,
  hashScimToken,
  listScimUsers,
  parseProvisioningCsv,
  provisionFromCsv,
  revokeScimToken,
  createScimUser,
  deleteScimUser,
  getScimUser,
  patchScimUser,
  type ScimUser,
} from '../index.ts';

const mailer = { send: () => Promise.resolve() };

async function run(tx: Transaction, csv: string, dryRun: boolean) {
  const { a, ua } = await seedTwoTenants(tx);
  const seeded = (await invitations(tx, a.id)).length;
  const report = await inWorkspace(tx, a.id, (s) =>
    provisionFromCsv(s, {
      workspaceId: a.id,
      actorUserId: ua,
      csv,
      dryRun,
      mailer,
      appUrl: 'https://app.example.test',
    }),
  );
  return { a, ua, report, seeded };
}

const invitations = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s.select().from(schema.invitation).where(eq(schema.invitation.organizationId, workspaceId)),
  );

describe('provisioning CSV', () => {
  it('parses BOM, CRLF and quoted fields, and reports bad rows by line', () => {
    const parsed = parseProvisioningCsv(
      '﻿email,name,role\r\nA@x.io,"Rao, Asha",junior\r\nbad,,\r\na@x.io,,viewer\r\nb@x.io,,owner\r\n',
    );
    expect(parsed.rows).toEqual([{ line: 2, email: 'a@x.io', name: 'Rao, Asha', role: 'junior' }]);
    expect(parsed.errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });

  it('provisions 100 users from a CSV as invitations', async () => {
    await withTestDb(async (tx) => {
      const lines = Array.from({ length: 100 }, (_, i) => `user${i}@csv.example.test,User ${i},viewer`);
      const { a, report, seeded } = await run(tx, ['email,name,role', ...lines].join('\n'), false);
      expect(report).toMatchObject({ totalRows: 100, created: 100, skipped: 0, errors: 0 });
      expect(await invitations(tx, a.id)).toHaveLength(seeded + 100);
    });
  });

  it('a dry run writes only its run row', async () => {
    await withTestDb(async (tx) => {
      const { a, report, seeded } = await run(tx, 'email,role\nx@csv.example.test,viewer\n', true);
      expect(report).toMatchObject({ dryRun: true, created: 1 });
      expect(await invitations(tx, a.id)).toHaveLength(seeded);
      const runs = await inWorkspace(tx, a.id, (s) => s.select().from(schema.provisioningRun));
      expect(runs.filter((r) => r.id === report.runId && r.dryRun)).toHaveLength(1);
    });
  });

  it('reports an invalid role and a duplicate row without stopping the others', async () => {
    await withTestDb(async (tx) => {
      const { report } = await run(
        tx,
        'email,role\nok@csv.example.test,clerk\nok@csv.example.test,clerk\nno@csv.example.test,king\n',
        false,
      );
      expect(report).toMatchObject({ created: 1, errors: 2 });
    });
  });
});

describe('SCIM', () => {
  async function setup(tx: Transaction) {
    const { a, ua, b } = await seedTwoTenants(tx);
    const { secret, token } = await inWorkspace(tx, a.id, (s) =>
      createScimToken(s, { workspaceId: a.id, actorUserId: ua, name: 'idp' }),
    );
    return { a, b, ua, secret, token, auth: `Bearer ${secret}` };
  }

  it('stores only the hash and rejects revoked and expired tokens', async () => {
    await withTestDb(async (tx) => {
      const { a, ua, secret, token } = await setup(tx);
      const [row] = await inWorkspace(tx, a.id, (s) =>
        s.select().from(schema.scimToken).where(eq(schema.scimToken.id, token.id)),
      );
      expect(row?.tokenHash).toBe(hashScimToken(secret));
      expect(await authenticateScimToken(tx, secret)).toMatchObject({ workspaceId: a.id });
      expect(await authenticateScimToken(tx, `${secret}x`)).toBeNull();
      await inWorkspace(tx, a.id, (s) => revokeScimToken(s, a.id, ua, token.id));
      expect(await authenticateScimToken(tx, secret)).toBeNull();
      const short = await inWorkspace(tx, a.id, (s) =>
        createScimToken(s, {
          workspaceId: a.id,
          actorUserId: ua,
          name: 'short',
          expiresAt: new Date(Date.now() + 1000),
        }),
      );
      expect(
        await authenticateScimToken(tx, short.secret, new Date(Date.now() + 60_000)),
      ).toBeNull();
    });
  });

  it('creates, reads, patches and deletes a user in the token workspace', async () => {
    await withTestDb(async (tx) => {
      const { a, auth } = await setup(tx);
      const created = await handleScim(tx, auth, (s, id) =>
        createScimUser(s, id, { userName: 'Scim@Example.test', roles: [{ value: 'junior' }] }),
      );
      expect(created.status).toBe(201);
      const user = created.body as ScimUser;
      expect(user).toMatchObject({ userName: 'scim@example.test', active: true });
      expect(user.roles).toEqual([{ value: 'junior' }]);
      const dup = await handleScim(tx, auth, (s, id) =>
        createScimUser(s, id, { userName: 'scim@example.test' }),
      );
      expect(dup.status).toBe(409);

      const got = await handleScim(tx, auth, (s, id) => getScimUser(s, id, user.id));
      expect(got.status).toBe(200);
      const found = await handleScim(tx, auth, (s, id) =>
        listScimUsers(s, id, { filter: 'userName eq "scim@example.test"' }),
      );
      expect(found.body).toMatchObject({ totalResults: 1 });

      const patched = await handleScim(tx, auth, (s, id) =>
        patchScimUser(s, id, user.id, {
          Operations: [{ op: 'replace', path: 'active', value: false }],
        }),
      );
      expect((patched.body as ScimUser).active).toBe(false);
      const status = async () =>
        (
          await inWorkspace(tx, a.id, (s) =>
            s
              .select({ status: schema.member.status })
              .from(schema.member)
              .where(and(eq(schema.member.userId, user.id), eq(schema.member.organizationId, a.id))),
          )
        )[0]?.status;
      expect(await status()).toBe('suspended');

      expect((await handleScim(tx, auth, (s, id) => deleteScimUser(s, id, user.id))).status).toBe(204);
      expect(await status()).toBe('removed');
      expect((await handleScim(tx, auth, (s, id) => getScimUser(s, id, user.id))).status).toBe(404);
    });
  });

  it('answers 401 for a missing or unknown token and runs nothing', async () => {
    await withTestDb(async (tx) => {
      const { secret } = await setup(tx);
      let ran = false;
      const body = (s: Transaction) => {
        ran = true;
        return listScimUsers(s, { tokenId: '', workspaceId: '' });
      };
      expect((await handleScim(tx, null, body)).status).toBe(401);
      expect((await handleScim(tx, `Bearer ${secret}0`, body)).status).toBe(401);
      expect(ran).toBe(false);
    });
  });

  it('never exposes another workspace’s member', async () => {
    await withTestDb(async (tx) => {
      const { auth, b } = await setup(tx);
      const [other] = await inWorkspace(tx, b.id, (s) =>
        s.select({ userId: schema.member.userId }).from(schema.member).where(eq(schema.member.organizationId, b.id)),
      );
      const result = await handleScim(tx, auth, (s, id) => getScimUser(s, id, other?.userId ?? ''));
      expect(result.status).toBe(404);
    });
  });
});
