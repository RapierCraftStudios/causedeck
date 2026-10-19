// The billing seat gate and entitlements against a real Postgres (Testcontainers, #203). Every test
// runs in a rolled-back transaction.
import { randomUUID } from 'node:crypto';

import { EntitlementError } from '@causedeck/billing';
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import * as core from '../../workspaces/index.ts';
import { acceptInvitation, createWorkspace, setEntitlements } from '../../workspaces/index.ts';
import {
  assertEntitled,
  getWorkspaceEntitlements,
  installBillingEntitlements,
  invalidateEntitlements,
} from '../index.ts';

const APP_URL = 'http://localhost:3000';
const mailer = { send: () => Promise.resolve() };

async function newUser(tx: Transaction, email = `${randomUUID()}@example.test`): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: 'User', email })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

async function setup(tx: Transaction) {
  await seedPlans(tx);
  const ownerId = await newUser(tx);
  const workspace = await createWorkspace(tx, {
    userId: ownerId,
    input: { name: `Chambers ${randomUUID().slice(0, 8)}` },
  });
  return { ownerId, workspaceId: workspace.id };
}

function subscribe(
  tx: Transaction,
  workspaceId: string,
  values: { planId: string; seats: number; clerkSeats: number; status?: string },
) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.subscription)
      .values({ workspaceId, status: 'active', ...values })
      .returning({ id: schema.subscription.id }),
  );
}

function invite(
  tx: Transaction,
  workspaceId: string,
  ownerId: string,
  role: 'advocate' | 'junior' | 'clerk' | 'viewer',
  email = `${randomUUID()}@example.test`,
) {
  return inWorkspace(tx, workspaceId, (s) =>
    core.inviteMember(s, {
      workspaceId,
      actorUserId: ownerId,
      input: { email, role },
      mailer,
      appUrl: APP_URL,
    }),
  );
}

async function join(
  tx: Transaction,
  workspaceId: string,
  ownerId: string,
  role: 'advocate' | 'junior' | 'clerk' | 'viewer',
) {
  const email = `${randomUUID()}@example.test`;
  const userId = await newUser(tx, email);
  const { token } = await invite(tx, workspaceId, ownerId, role, email);
  return acceptInvitation(tx, { userId, token });
}

async function seatError(promise: Promise<unknown>): Promise<EntitlementError> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EntitlementError);
  return error as EntitlementError;
}

afterEach(() => {
  setEntitlements(null);
});

describe('billing seat gate', () => {
  it('lets a Junior workspace keep only the owner seat', async () => {
    await withTestDb(async (tx) => {
      installBillingEntitlements();
      const { ownerId, workspaceId } = await setup(tx);
      const error = await seatError(invite(tx, workspaceId, ownerId, 'advocate'));
      expect(error).toMatchObject({ code: 'ENTITLEMENT_EXCEEDED', key: 'seats', limit: 1 });
      expect((await seatError(invite(tx, workspaceId, ownerId, 'clerk'))).key).toBe('clerk_seats');
    });
  });

  it('blocks inviting beyond purchased chamber seats, counting clerk seats apart', async () => {
    await withTestDb(async (tx) => {
      installBillingEntitlements();
      const { ownerId, workspaceId } = await setup(tx);
      await subscribe(tx, workspaceId, { planId: 'chamber-seat-1', seats: 3, clerkSeats: 1 });

      await join(tx, workspaceId, ownerId, 'advocate');
      await join(tx, workspaceId, ownerId, 'junior');
      await join(tx, workspaceId, ownerId, 'clerk');

      const seats = await seatError(invite(tx, workspaceId, ownerId, 'viewer'));
      expect(seats).toMatchObject({ key: 'seats', limit: 3, requested: 4 });
      const clerks = await seatError(invite(tx, workspaceId, ownerId, 'clerk'));
      expect(clerks).toMatchObject({ key: 'clerk_seats', limit: 1, requested: 2 });
    });
  });

  it('blocks accepting an invitation once the seats are taken', async () => {
    await withTestDb(async (tx) => {
      installBillingEntitlements();
      const { ownerId, workspaceId } = await setup(tx);
      await subscribe(tx, workspaceId, { planId: 'chamber-seat-1', seats: 3, clerkSeats: 0 });

      const email = `${randomUUID()}@example.test`;
      const userId = await newUser(tx, email);
      const { token } = await invite(tx, workspaceId, ownerId, 'junior', email);
      await join(tx, workspaceId, ownerId, 'advocate');
      await join(tx, workspaceId, ownerId, 'advocate');

      await seatError(acceptInvitation(tx, { userId, token }));
    });
  });
});

describe('workspace entitlements', () => {
  it('sees a subscription change on the next request after invalidation', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const read = () =>
        inWorkspace(tx, workspaceId, (s) => getWorkspaceEntitlements(s, workspaceId));
      invalidateEntitlements(workspaceId);

      expect(await read()).toMatchObject({ planId: 'junior', max_active_matters: 15 });
      await expect(
        inWorkspace(tx, workspaceId, (s) =>
          assertEntitled(s, { workspaceId }, 'max_active_matters', 16),
        ),
      ).rejects.toMatchObject({ code: 'ENTITLEMENT_EXCEEDED' });

      const [row] = await subscribe(tx, workspaceId, {
        planId: 'chamber-seat-1',
        seats: 4,
        clerkSeats: 1,
      });
      expect((await read()).planId).toBe('junior');
      invalidateEntitlements(workspaceId);
      expect(await read()).toMatchObject({ planId: 'chamber-seat-1', seats: 4, clerk_seats: 1 });

      // Beyond grace the workspace drops to read-only Junior limits.
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.subscription)
          .set({ status: 'expired' })
          .where(eq(schema.subscription.id, row?.id ?? '')),
      );
      invalidateEntitlements(workspaceId);
      expect(await read()).toMatchObject({ planId: 'junior', readOnly: true });
    });
  });
});
