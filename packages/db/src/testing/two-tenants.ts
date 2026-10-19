// Two-tenant fixture for the cross-tenant suite (#19, #209): workspaces A and B, users `ua` (owner
// of A), `ub` (owner of B) and `uboth` (an advocate in both), and one seed row in every tenant
// table of each workspace. Tenant rows are written inside their own workspace scope, as application
// code must under FORCE RLS. Ids are random, so it works inside `withTestDb` (rolled back) and on
// committed data (the api and web suites, whose users come from Better Auth).
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Database, Transaction } from '../client.ts';
import { registeredTenantTables } from '../rls-policies.ts';
import { withWorkspace } from '../rls.ts';
import { invitation, member, organization, user } from '../schema/auth.ts';
import { billingEvent, entitlement, plan, subscription, usageCounter } from '../schema/billing.ts';
import { jobEffect } from '../schema/job-effect.ts';
import { notification, notificationPref } from '../schema/notifications.ts';
import { workspaceSettings, workspaceSlugHistory } from '../schema/workspace.ts';

type Queryable = Database | Transaction;

/** The global plan row the billing seed rows point at. */
export const TWO_TENANTS_PLAN_ID = 'xt_seed_plan';

export interface SeedContext {
  workspaceId: string;
  /** The workspace's owner (`ua` for A, `ub` for B). */
  ownerId: string;
  /** Unique per seeding run, for values with global unique constraints. */
  tag: string;
}

/** What a seeder wrote: the ids (or keys) that identify the row. */
export type SeedRow = Record<string, string>;

/** Writes one row into its table for `ctx.workspaceId`, on a transaction scoped to it. */
export type TenantSeeder = (tx: Transaction, ctx: SeedContext) => Promise<SeedRow>;

function first<T>(rows: T[], table: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`two-tenants: ${table} insert returned no row`);
  return row;
}

async function newUser(q: Queryable, label: string): Promise<string> {
  const rows = await q
    .insert(user)
    .values({ name: `Advocate ${label}`, email: `${label}-${randomUUID()}@example.test` })
    .returning({ id: user.id });
  return first(rows, 'user').id;
}

/** The invite-token hash `@causedeck/core` stores (sha256 hex of the plaintext token). */
export function invitationTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * One seeder per tenant table. A table registered for RLS without a seeder here fails the
 * cross-tenant registry test, so a new tenant table cannot skip the suite.
 */
export const TENANT_SEEDERS: Record<string, TenantSeeder> = {
  member: async (tx, { workspaceId, tag }) => {
    const userId = await newUser(tx, `viewer-${tag}`);
    const rows = await tx
      .insert(member)
      .values({ organizationId: workspaceId, userId, role: 'viewer' })
      .returning({ id: member.id });
    return { memberId: first(rows, 'member').id, userId };
  },
  invitation: async (tx, { workspaceId, ownerId, tag }) => {
    const token = randomBytes(32).toString('base64url');
    const rows = await tx
      .insert(invitation)
      .values({
        organizationId: workspaceId,
        email: `invitee-${tag}-${randomUUID()}@example.test`,
        role: 'viewer',
        inviterId: ownerId,
        tokenHash: invitationTokenHash(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: invitation.id, email: invitation.email });
    const row = first(rows, 'invitation');
    return { invitationId: row.id, email: row.email, token };
  },
  workspace_settings: async (tx, { workspaceId }) => {
    await tx.insert(workspaceSettings).values({ workspaceId });
    return { workspaceId };
  },
  workspace_slug_history: async (tx, { workspaceId, tag }) => {
    const slug = `xt-old-${tag}-${randomUUID().slice(0, 8)}`;
    await tx.insert(workspaceSlugHistory).values({
      workspaceId,
      slug,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    return { slug };
  },
  job_effect: async (tx, { workspaceId }) => {
    const rows = await tx
      .insert(jobEffect)
      .values({ workspaceId, jobName: 'xt.seed', idempotencyKey: randomUUID() })
      .returning({ id: jobEffect.id });
    return { jobEffectId: first(rows, 'job_effect').id };
  },
  subscription: async (tx, { workspaceId }) => {
    const rows = await tx
      .insert(subscription)
      .values({ workspaceId, planId: TWO_TENANTS_PLAN_ID, status: 'active' })
      .returning({ id: subscription.id });
    return { subscriptionId: first(rows, 'subscription').id };
  },
  entitlement: async (tx, { workspaceId }) => {
    const key = `xt.seed.${randomUUID()}`;
    await tx.insert(entitlement).values({ workspaceId, key, value: { seeded: true } });
    return { key };
  },
  usage_counter: async (tx, { workspaceId }) => {
    const key = `xt.seed.${randomUUID()}`;
    await tx.insert(usageCounter).values({ workspaceId, key, periodStart: new Date(), value: 1 });
    return { key };
  },
  billing_event: async (tx, { workspaceId }) => {
    const providerEventId = `xt_evt_${randomUUID()}`;
    await tx
      .insert(billingEvent)
      .values({ providerEventId, workspaceId, type: 'xt.seed', payloadHash: randomUUID() });
    return { providerEventId };
  },
  notification: async (tx, { workspaceId, ownerId }) => {
    const rows = await tx
      .insert(notification)
      .values({ workspaceId, userId: ownerId, category: 'system.notice', title: 'Seed notice' })
      .returning({ id: notification.id });
    return { notificationId: first(rows, 'notification').id, userId: ownerId };
  },
  notification_pref: async (tx, { workspaceId, ownerId }) => {
    await tx.insert(notificationPref).values({
      workspaceId,
      userId: ownerId,
      category: 'system.notice',
      channel: 'email',
      enabled: false,
    });
    return { userId: ownerId, category: 'system.notice', channel: 'email' };
  },
};

/** Registered tenant tables with no seeder (the registry test expects none). */
export function unseededTenantTables(): string[] {
  return registeredTenantTables().filter((table) => !(table in TENANT_SEEDERS));
}

export interface TenantFixture {
  id: string;
  slug: string;
  name: string;
  /** Seed row per tenant table, by table name. */
  rows: Record<string, SeedRow>;
}

export interface TwoTenants {
  a: TenantFixture;
  b: TenantFixture;
  ua: string;
  ub: string;
  uboth: string;
}

export interface TwoTenantsOptions {
  /** Existing user ids (e.g. signed in through Better Auth); new users are created otherwise. */
  users?: { ua: string; ub: string; uboth: string };
}

async function seedWorkspace(
  q: Queryable,
  label: 'a' | 'b',
  ownerId: string,
  uboth: string,
): Promise<TenantFixture> {
  const id = randomUUID();
  const tag = `${label}-${id.slice(0, 8)}`;
  const slug = `xt-${tag}`;
  const name = `Chambers ${label.toUpperCase()} ${id.slice(0, 8)}`;
  const rows: Record<string, SeedRow> = {};
  await withWorkspace(q, { workspaceId: id, userId: ownerId }, async (tx) => {
    await tx.insert(organization).values({ id, name, slug, createdBy: ownerId });
    await tx.insert(member).values([
      { organizationId: id, userId: ownerId, role: 'owner' },
      { organizationId: id, userId: uboth, role: 'advocate' },
    ]);
    for (const table of registeredTenantTables()) {
      const seeder = TENANT_SEEDERS[table];
      if (seeder === undefined) throw new Error(`two-tenants: no seeder for tenant table ${table}`);
      rows[table] = await seeder(tx, { workspaceId: id, ownerId, tag });
    }
  });
  return { id, slug, name, rows };
}

/** Seed workspaces A and B, their users and a row in every tenant table of each. */
export async function seedTwoTenants(
  q: Queryable,
  { users }: TwoTenantsOptions = {},
): Promise<TwoTenants> {
  await q
    .insert(plan)
    .values({
      id: TWO_TENANTS_PLAN_ID,
      name: 'Cross-tenant seed',
      kind: 'advocate',
      interval: 'month',
      pricePaise: 0,
    })
    .onConflictDoNothing();
  const ua = users?.ua ?? (await newUser(q, 'ua'));
  const ub = users?.ub ?? (await newUser(q, 'ub'));
  const uboth = users?.uboth ?? (await newUser(q, 'uboth'));
  const a = await seedWorkspace(q, 'a', ua, uboth);
  const b = await seedWorkspace(q, 'b', ub, uboth);
  return { a, b, ua, ub, uboth };
}
