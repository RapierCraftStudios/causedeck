// Cross-tenant email intake (#54 part 2): user `ub`, working in workspace B, calls the email-intake
// services with workspace A's ids. Revoking an address or removing an entry of A is NOT_FOUND and
// leaves A's rows unchanged; listing from B's scope shows nothing of A's; rotating and creating act
// on B's own member only; `resolveAddress` answers by address alone and never says which workspace
// an unknown or revoked address was in.
import { captureConfigFromEnv } from '@causedeck/capture';
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMemoryObjectStore } from '@causedeck/storage';
import { describe, expect, it } from 'vitest';

import {
  addAllowlistEntry,
  createAddress,
  listAllowlist,
  receiveInboundEmail,
  removeAllowlistEntry,
  resolveAddress,
  revokeAddress,
  rotateAddress,
  runEmailIntake,
  sweepExpiredRawMime,
  type EmailIntakeCtx,
} from '../../email-intake/index.ts';

const ctxFor = (tx: EmailIntakeCtx['db'], workspaceId: string, userId: string): EmailIntakeCtx => ({
  db: tx,
  workspaceId,
  userId,
  domain: 'intake.test',
  authorize: () => undefined,
});

describe('email-intake cross-tenant', () => {
  it('B cannot list, revoke, remove or rotate A, and A is unchanged', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const a = ctxFor(tx, t.a.id, t.ua);
      const b = ctxFor(tx, t.b.id, t.ub);
      // The seeded owner addresses are active: A's is the target, B's the caller's own.
      const aAddressId = t.a.rows.intake_address?.id ?? '';
      const aEntry = await addAllowlistEntry(a, { pattern: 'court.a.test', kind: 'court' });
      const snapshot = () =>
        inWorkspace(tx, t.a.id, async (s) => ({
          addresses: await s.select().from(schema.intakeAddress).orderBy(schema.intakeAddress.id),
          allowlist: await s
            .select()
            .from(schema.intakeAllowlist)
            .orderBy(schema.intakeAllowlist.id),
        }));
      const before = await snapshot();

      // B's scope sees none of A's allow-list.
      const bList = await inWorkspace(tx, t.b.id, (s) => listAllowlist(s, t.b.id));
      expect(bList.map((entry) => entry.id)).not.toContain(aEntry.id);
      expect(await inWorkspace(tx, t.b.id, (s) => listAllowlist(s, t.a.id))).toEqual([]);
      // B names A's ids.
      await expect(revokeAddress(b, aAddressId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(removeAllowlistEntry(b, aEntry.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // A context for A's workspace with B's user finds no row to rotate.
      await expect(rotateAddress(ctxFor(tx, t.a.id, t.ub))).rejects.toBeDefined();
      // B's own rotate touches only B.
      const bAddress = await rotateAddress(b);
      expect(bAddress.userId).toBe(t.ub);

      expect(await snapshot()).toEqual(before);
    });
  });

  it('resolve never reveals a workspace for a revoked or unknown address', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      // `uboth` has no seeded address in A.
      const a = ctxFor(tx, t.a.id, t.uboth);
      const created = await createAddress(a);
      await revokeAddress(a, created.id);
      expect(await resolveAddress(tx, created.address)).toBeNull();
      expect(await resolveAddress(tx, 'u-bbbbbbbbbb@intake.test')).toBeNull();
    });
  });

  it('inbound receive, run and sweep act only on the workspace the address or ids name (#530)', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const snapshot = () =>
        inWorkspace(tx, t.a.id, (s) =>
          s.select().from(schema.intakeMessage).orderBy(schema.intakeMessage.id),
        );
      const before = await snapshot();
      const aMessageId = t.a.rows.intake_message?.id ?? '';

      // B's address records into B only: A's messages are unchanged (and B's channel is off).
      const bAddress = await createAddress(ctxFor(tx, t.b.id, t.uboth));
      expect(
        await receiveInboundEmail(tx, {
          address: bAddress.address,
          messageId: '<xt-in@mail.test>',
          rawMimeRef: 'a.eml',
        }),
      ).toEqual({ status: 'dropped', reason: 'channel_disabled' });

      // B's scope runs A's message id as not found, and sweeps nothing of A's.
      const deps = {
        db: tx,
        store: createMemoryObjectStore(),
        provider: { fetchRaw: () => Promise.resolve(new Uint8Array()) },
        config: captureConfigFromEnv({}),
        jobs: { scan: () => Promise.resolve(), process: () => Promise.resolve() },
      };
      expect(
        await runEmailIntake(deps, {
          workspaceId: t.b.id,
          userId: t.ub,
          intakeMessageId: aMessageId,
        }),
      ).toEqual({ outcome: 'missing' });
      const far = () => new Date(Date.now() + 365 * 86_400_000);
      expect(
        await sweepExpiredRawMime({ db: tx, provider: {}, now: far }, t.b.id, aMessageId),
      ).toEqual({ deleted: 0 });

      expect(await snapshot()).toEqual(before);
    });
  });
});
