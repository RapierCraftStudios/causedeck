// The staff CLI (#308): staff accounts are created and disabled only by an operator through this
// CLI, as the owner role; the app role cannot write `staff_user`, and no source outside this CLI
// inserts into it. Disabling a staff member ends their support sessions immediately.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Secret } from '@causedeck/config/env';
import {
  assertActiveSupportSession,
  grantSession,
  requestSession,
  SupportSessionInactiveError,
} from '@causedeck/core/support';
import { createDb, schema, withWorkspace, type Database } from '@causedeck/db';
import { testDatabaseUrls } from '@causedeck/db/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEV_STAFF_EMAIL } from '../../lib/roles.ts';

import {
  addStaff,
  disableStaff,
  parseStaffArgs,
  runStaffCli,
  seedDevStaff,
  StaffCliError,
} from './staff';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const THIS_CLI = path.join(REPO_ROOT, 'apps/admin/src/cli/staff.ts');

let owner: Database;
let app: Database;
const userIds: string[] = [];
const workspaceIds: string[] = [];

async function newUser(label: string): Promise<{ id: string; email: string }> {
  const email = `${label}-${randomUUID()}@Example.test`;
  const [row] = await owner
    .insert(schema.user)
    .values({ name: label, email: email.toLowerCase() })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  userIds.push(row.id);
  return { id: row.id, email };
}

beforeAll(() => {
  owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
  app = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 2 });
});

afterAll(async () => {
  for (const workspaceId of workspaceIds) {
    await withWorkspace(app, { workspaceId }, (tx) =>
      tx.delete(schema.organization).where(eq(schema.organization.id, workspaceId)),
    );
  }
  if (userIds.length > 0) {
    await owner.delete(schema.user).where(inArray(schema.user.id, userIds));
  }
  await owner.$client.end();
  await app.$client.end();
});

describe('parseStaffArgs', () => {
  it('parses add and disable', () => {
    expect(parseStaffArgs(['add', 'a@b.in', '--role', 'ops'])).toEqual({
      command: 'add',
      email: 'a@b.in',
      role: 'ops',
    });
    expect(parseStaffArgs(['add', 'a@b.in', '--role=admin', '--by', 'c@d.in'])).toEqual({
      command: 'add',
      email: 'a@b.in',
      role: 'admin',
      by: 'c@d.in',
    });
    expect(parseStaffArgs(['disable', '--', 'a@b.in'])).toEqual({
      command: 'disable',
      email: 'a@b.in',
    });
  });

  it.each([
    [['add', 'a@b.in']],
    [['add', 'a@b.in', '--role', 'owner']],
    [['add', 'not-an-email', '--role', 'ops']],
    [['remove', 'a@b.in']],
    [['seed-dev', 'a@b.in']],
    [[]],
  ])('rejects %j as bad usage', (argv) => {
    expect(() => parseStaffArgs(argv)).toThrow(StaffCliError);
    try {
      parseStaffArgs(argv);
    } catch (error) {
      expect((error as StaffCliError).exitCode).toBe(2);
    }
  });

  it('parses seed-dev (#309)', () => {
    expect(parseStaffArgs(['seed-dev'])).toEqual({ command: 'seed-dev' });
  });

  it('exits 2 on bad usage before touching the database', async () => {
    const errors: string[] = [];
    expect(
      await runStaffCli(
        ['add', 'a@b.in'],
        () => undefined,
        (l) => errors.push(l),
      ),
    ).toBe(2);
    expect(errors.join('\n')).toContain('--role');
  });
});

describe('staff accounts are created only by the operator CLI', () => {
  it('addStaff (owner role) creates staff by email, case-insensitively, and re-enables', async () => {
    const u = await newUser('staff-add');
    const added = await addStaff(owner, { email: u.email.toUpperCase(), role: 'support' });
    expect(added).toEqual({ userId: u.id, role: 'support', reenabled: false });
    await owner
      .update(schema.staffUser)
      .set({ disabledAt: new Date() })
      .where(eq(schema.staffUser.userId, u.id));
    expect(await addStaff(owner, { email: u.email, role: 'ops' })).toEqual({
      userId: u.id,
      role: 'ops',
      reenabled: true,
    });
    const [row] = await owner
      .select()
      .from(schema.staffUser)
      .where(eq(schema.staffUser.userId, u.id));
    expect(row).toMatchObject({ role: 'ops', disabledAt: null });

    await expect(addStaff(owner, { email: 'nobody@example.test', role: 'ops' })).rejects.toThrow(
      StaffCliError,
    );
  });

  it('the app role (everything the product and its UI run as) cannot create or change staff', async () => {
    const u = await newUser('staff-app');
    const denied = (p: Promise<unknown>) =>
      p.then(
        () => 'allowed',
        (e: unknown) =>
          ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code,
      );
    expect(await denied(app.insert(schema.staffUser).values({ userId: u.id, role: 'admin' }))).toBe(
      '42501',
    );
    expect(await denied(app.execute(sql`update staff_user set role = 'admin'`))).toBe('42501');
  });

  it('seedDevStaff creates the dev staff account as admin, idempotently (#309)', async () => {
    const first = await seedDevStaff(owner);
    const second = await seedDevStaff(owner);
    expect(second.userId).toBe(first.userId);
    const [row] = await owner
      .select({ role: schema.staffUser.role, disabledAt: schema.staffUser.disabledAt })
      .from(schema.staffUser)
      .where(eq(schema.staffUser.userId, first.userId));
    expect(row).toEqual({ role: 'admin', disabledAt: null });
    const [account] = await owner
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, first.userId));
    expect(account?.email).toBe(DEV_STAFF_EMAIL);
  });

  it('no source outside this CLI writes staff_user', () => {
    const roots = ['apps', 'packages'].map((d) => path.join(REPO_ROOT, d));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) {
          walk(file);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        if (file === THIS_CLI || file.includes(`${path.sep}__tests__${path.sep}`)) continue;
        const text = readFileSync(file, 'utf8');
        if (
          /insert\(\s*(schema\.)?staffUser\b|update\(\s*(schema\.)?staffUser\b|(insert into|update)\s+"?staff_user/i.test(
            text,
          )
        ) {
          offenders.push(path.relative(REPO_ROOT, file));
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});

describe('disabling a staff member', () => {
  it('ends their support sessions immediately and audits the end', async () => {
    const staff = await newUser('staff-disable');
    const ownerUser = await newUser('owner');
    await addStaff(owner, { email: staff.email, role: 'support' });
    const workspaceId = randomUUID();
    workspaceIds.push(workspaceId);
    await withWorkspace(app, { workspaceId, userId: ownerUser.id }, async (tx) => {
      await tx
        .insert(schema.organization)
        .values({ id: workspaceId, name: 'Chambers', slug: `adm-${workspaceId}` });
      await tx
        .insert(schema.member)
        .values({ organizationId: workspaceId, userId: ownerUser.id, role: 'owner' });
    });
    const pending = await requestSession(
      { db: app, staffUserId: staff.id },
      { workspaceId, reason: 'Investigating a sync issue' },
    );
    await grantSession(
      { db: app, userId: ownerUser.id, workspaceId },
      { sessionId: pending.id, minutes: 60 },
    );
    expect((await assertActiveSupportSession(staff.id, workspaceId, { db: app })).id).toBe(
      pending.id,
    );

    expect(await disableStaff(owner, { email: staff.email })).toEqual({
      userId: staff.id,
      endedSessions: 1,
    });
    await expect(
      assertActiveSupportSession(staff.id, workspaceId, { db: app }),
    ).rejects.toBeInstanceOf(SupportSessionInactiveError);

    const rows = await withWorkspace(app, { workspaceId }, async (tx) => ({
      sessions: await tx
        .select({ status: schema.supportSession.status })
        .from(schema.supportSession),
      ended: await tx
        .select({ targetId: schema.auditEvent.targetId, metadata: schema.auditEvent.metadata })
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.action, 'support.session_ended')),
    }));
    expect(rows.sessions).toEqual([{ status: 'ended' }]);
    expect(rows.ended).toEqual([
      { targetId: pending.id, metadata: { endReason: 'staff_disabled' } },
    ]);

    await expect(disableStaff(owner, { email: ownerUser.email })).rejects.toThrow(
      'That user is not staff.',
    );
  });
});
