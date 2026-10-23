// Cross-tenant email intake (#54 part 2): user `ub`, working in workspace B, calls the email-intake
// services with workspace A's ids. Revoking an address or removing an entry of A is NOT_FOUND and
// leaves A's rows unchanged; listing from B's scope shows nothing of A's; rotating and creating act
// on B's own member only; `resolveAddress` answers by address alone and never says which workspace
// an unknown or revoked address was in.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { describe, expect, it } from 'vitest';

import {
  addAllowlistEntry,
  createAddress,
  listAllowlist,
  removeAllowlistEntry,
  resolveAddress,
  revokeAddress,
  rotateAddress,
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
      const aAddress = await createAddress(a);
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
      expect(await inWorkspace(tx, t.b.id, (s) => listAllowlist(s, t.b.id))).toEqual([]);
      expect(await inWorkspace(tx, t.b.id, (s) => listAllowlist(s, t.a.id))).toEqual([]);
      // B names A's ids.
      await expect(revokeAddress(b, aAddress.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(removeAllowlistEntry(b, aEntry.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // A context for A's workspace with B's user finds no row to rotate.
      await expect(rotateAddress(ctxFor(tx, t.a.id, t.ub))).rejects.toBeDefined();
      // B's own create touches only B.
      const bAddress = await createAddress(b);
      expect(bAddress.userId).toBe(t.ub);

      expect(await snapshot()).toEqual(before);
    });
  });

  it('resolve never reveals a workspace for a revoked or unknown address', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const a = ctxFor(tx, t.a.id, t.ua);
      const created = await createAddress(a);
      await revokeAddress(a, created.id);
      expect(await resolveAddress(tx, created.address)).toBeNull();
      expect(await resolveAddress(tx, 'u-bbbbbbbbbb@intake.test')).toBeNull();
    });
  });
});
