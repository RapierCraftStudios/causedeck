// Cross-tenant server actions (#19, #209), against the real test database (run by
// `vitest.tenancy.config.ts`, which starts it; the default web config excludes this file). User `ub`
// owns workspace B and calls every server action with workspace A's ids: workspace actions answer
// FORBIDDEN for A's workspace and NOT_FOUND (or nothing) for A's member and invitation ids under B,
// and A's rows never change. The workspace loader shows A's slug to `ub` as not-found, which covers
// `resolveSlug` (caller-checked in the registry). Every exported action is listed in ACTIONS.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { schema, withWorkspace } from '@causedeck/db';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const state = vi.hoisted(() => ({ session: null as AppSession | null }));
const updateUser = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@causedeck/db', async (original) => {
  const actual = await original<Record<string, unknown>>();
  const { testAppDb: appDb } = await import('@causedeck/db/testing');
  return { ...actual, db: appDb() };
});
vi.mock('../lib/auth.ts', () => ({
  getSession: () => Promise.resolve(state.session),
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
  getAuth: () => ({ $context: Promise.resolve({ internalAdapter: { updateUser } }) }),
}));
vi.mock('../lib/env.ts', () => ({
  isProd: () => false,
  serverEnv: () => ({ APP_URL: 'http://localhost:3000', EMAIL_PROVIDER: 'console' }),
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/auth/mailer', () => ({
  createMailer: () => ({ send: () => Promise.resolve() }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ set: vi.fn() }) }));
vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve('en'),
  getTranslations: () => Promise.resolve((key: string) => key),
}));

const members = await import('../app/(app)/w/[slug]/settings/members/actions.ts');
const invite = await import('../app/(public)/invite/[token]/actions.ts');
const onboarding = await import('../app/(app)/onboarding/actions.ts');
const account = await import('../app/(app)/account/actions.ts');
const notifications = await import('../app/(app)/w/[slug]/notifications/actions.ts');
const preferences = await import('../app/(app)/w/[slug]/settings/notifications/actions.ts');
const profile = await import('../app/(app)/w/[slug]/settings/profile/actions.ts');
const activity = await import('../app/(app)/w/[slug]/activity/actions.ts');
const { loadWorkspaceContext } = await import('../lib/workspace-loader.ts');

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));

/** Every exported server action and the module it comes from. */
const ACTIONS: Record<string, Record<string, unknown>> = {
  inviteMembersAction: members,
  changeRoleAction: members,
  openWorkAction: members,
  removeMemberAction: members,
  resendInvitationAction: members,
  revokeInvitationAction: members,
  prepareTransferAction: members,
  confirmTransferAction: members,
  acceptInvitationAction: invite,
  createWorkspaceAction: onboarding,
  setLocaleAction: account,
  listNotificationsAction: notifications,
  markNotificationReadAction: notifications,
  markAllNotificationsReadAction: notifications,
  setNotificationPreferenceAction: preferences,
  setNotificationDigestAction: preferences,
  setCourtHoursQuietAction: preferences,
  setLockScreenDetailsAction: preferences,
  updateWorkspaceProfileAction: profile,
  loadMoreAuditAction: activity,
  verifyAuditEventAction: activity,
};

type Action = (raw: unknown) => Promise<unknown>;
const action = (name: string): Action => ACTIONS[name]?.[name] as Action;

let t: TwoTenants;
let aMember: { memberId: string; userId: string };
let aInvitation: { invitationId: string; token: string };
let aNotificationId: string;

function signInAs(userId: string): void {
  state.session = {
    session: {},
    user: { id: userId, name: 'Advocate', email: `${userId}@example.test` },
  } as unknown as AppSession;
}

/** A's members and invitations as A itself sees them. */
function snapshotA() {
  return withWorkspace(testAppDb(), { workspaceId: t.a.id }, async (tx) => ({
    members: await tx
      .select({ id: schema.member.id, role: schema.member.role, status: schema.member.status })
      .from(schema.member)
      .orderBy(schema.member.id),
    invitations: await tx
      .select({
        id: schema.invitation.id,
        tokenHash: schema.invitation.tokenHash,
        revokedAt: schema.invitation.revokedAt,
        acceptedAt: schema.invitation.acceptedAt,
      })
      .from(schema.invitation)
      .orderBy(schema.invitation.id),
    // Under A's scope the only visible workspace is A.
    workspace: await tx
      .select({
        slug: schema.organization.slug,
        name: schema.organization.name,
        kind: schema.organization.kind,
        deletedAt: schema.organization.deletedAt,
      })
      .from(schema.organization),
    workspaceSettings: await tx.select().from(schema.workspaceSettings),
    notifications: await tx
      .select({ id: schema.notification.id, readAt: schema.notification.readAt })
      .from(schema.notification)
      .orderBy(schema.notification.id),
    notificationPrefs: await tx.select().from(schema.notificationPref),
    notificationSettings: await tx.select().from(schema.notificationSetting),
  }));
}

function code(result: unknown): string | undefined {
  return (result as { error?: { code?: string } }).error?.code;
}

beforeAll(async () => {
  t = await seedTwoTenants(testAppDb());
  const m = t.a.rows.member;
  const inv = t.a.rows.invitation;
  if (!m?.memberId || !m.userId || !inv?.invitationId || !inv.token) throw new Error('seed rows');
  aMember = { memberId: m.memberId, userId: m.userId };
  aInvitation = { invitationId: inv.invitationId, token: inv.token };
  const n = t.a.rows.notification;
  if (!n?.notificationId) throw new Error('seed rows');
  aNotificationId = n.notificationId;
});

beforeEach(() => {
  signInAs(t.ub);
});

afterAll(closeTestDb);

/** Inputs naming workspace `workspaceId` with A's target ids. */
function inputs(workspaceId: string): Record<string, unknown> {
  return {
    inviteMembersAction: { workspaceId, emails: ['xt-probe@example.test'], role: 'junior' },
    changeRoleAction: { workspaceId, memberId: aMember.memberId, role: 'owner' },
    openWorkAction: { workspaceId, memberId: aMember.memberId },
    removeMemberAction: { workspaceId, memberId: aMember.memberId },
    resendInvitationAction: { workspaceId, invitationId: aInvitation.invitationId },
    revokeInvitationAction: { workspaceId, invitationId: aInvitation.invitationId },
    prepareTransferAction: { workspaceId, newOwnerUserId: t.ua },
    // The confirmation is the named workspace's slug, so the target lookup is what refuses.
    confirmTransferAction: {
      workspaceId,
      newOwnerUserId: t.ua,
      confirmation: workspaceId === t.b.id ? t.b.slug : t.a.slug,
    },
    listNotificationsAction: { workspaceId },
    markNotificationReadAction: { workspaceId, notificationId: aNotificationId },
    markAllNotificationsReadAction: { workspaceId },
    setNotificationPreferenceAction: {
      workspaceId,
      category: 'reminder.hearing',
      channel: 'email',
      enabled: false,
    },
    setNotificationDigestAction: { workspaceId, digest: 'off' },
    setCourtHoursQuietAction: { workspaceId, enabled: true },
    setLockScreenDetailsAction: { workspaceId, enabled: true },
    updateWorkspaceProfileAction: {
      workspaceId,
      name: 'Cross-tenant probe',
      kind: 'chamber',
      timezone: 'UTC',
      locale: 'kn',
      practiceCity: 'Probe City',
      slug: `xt-probe-${workspaceId.slice(0, 8)}`,
    },
    loadMoreAuditAction: { workspaceId, cursor: 'probe' },
    verifyAuditEventAction: {
      workspaceId,
      eventId: '00000000-0000-4000-8000-0000000000aa',
      createdAt: '2026-01-01T00:00:00.000000Z',
    },
  };
}

describe('cross-tenant server actions', () => {
  it('lists every exported server action', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && /^'use server'/m.test(readFileSync(full, 'utf8'))) {
          files.push(full);
        }
      }
    };
    walk(APP_DIR);
    const exported = files
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/export async function (\w+)/g)].map((m) => m[1]),
      )
      .sort();
    expect(exported).toEqual(Object.keys(ACTIONS).sort());
    for (const name of Object.keys(ACTIONS)) expect(typeof action(name), name).toBe('function');
  });

  it('every workspace action with A’s workspace id is FORBIDDEN for ub, and A is unchanged', async () => {
    const before = await snapshotA();
    for (const [name, input] of Object.entries(inputs(t.a.id))) {
      expect(code(await action(name)(input)), name).toBe('FORBIDDEN');
    }
    expect(await snapshotA()).toEqual(before);
  });

  it('under B’s own workspace, A’s member and invitation ids are not found', async () => {
    const before = await snapshotA();
    const all = inputs(t.b.id);
    for (const name of [
      'changeRoleAction',
      'removeMemberAction',
      'resendInvitationAction',
      'revokeInvitationAction',
      'prepareTransferAction',
      'confirmTransferAction',
    ]) {
      expect(code(await action(name)(all[name])), name).toBe('NOT_FOUND');
    }
    // Open work for a member outside B is simply none.
    expect(await action('openWorkAction')(all.openWorkAction)).toEqual({
      ok: true,
      data: { count: 0 },
    });
    expect(await snapshotA()).toEqual(before);
  });

  it('notifications under B’s own workspace never show or mark A’s notification', async () => {
    const before = await snapshotA();
    expect(before.notifications.map((row) => row.id)).toContain(aNotificationId);
    const all = inputs(t.b.id);
    expect(code(await action('markNotificationReadAction')(all.markNotificationReadAction))).toBe(
      'NOT_FOUND',
    );
    const list = (await action('listNotificationsAction')(all.listNotificationsAction)) as {
      ok: boolean;
      data: { items: { id: string }[]; unread: number };
    };
    expect(list.ok).toBe(true);
    expect(list.data.items.map((item) => item.id)).not.toContain(aNotificationId);
    expect(
      await action('markAllNotificationsReadAction')(all.markAllNotificationsReadAction),
    ).toMatchObject({
      ok: true,
    });
    expect(await snapshotA()).toEqual(before);
  });

  it('notification preferences under B’s own workspace change only ub’s rows in B', async () => {
    const before = await snapshotA();
    const all = inputs(t.b.id);
    for (const name of [
      'setNotificationPreferenceAction',
      'setNotificationDigestAction',
      'setCourtHoursQuietAction',
      'setLockScreenDetailsAction',
    ]) {
      expect(await action(name)(all[name]), name).toMatchObject({ ok: true });
    }
    expect(await snapshotA()).toEqual(before);
    const inB = await withWorkspace(testAppDb(), { workspaceId: t.b.id }, async (tx) => ({
      prefs: await tx.select().from(schema.notificationPref),
      settings: await tx.select().from(schema.notificationSetting),
    }));
    const mine = (rows: { userId: string; workspaceId: string }[]) =>
      rows.filter((row) => row.userId === t.ub && row.workspaceId === t.b.id);
    expect(mine(inB.prefs).length).toBeGreaterThan(0);
    expect(mine(inB.settings)).toHaveLength(1);
  });

  it('updateWorkspaceProfileAction under B’s own workspace changes only B', async () => {
    const before = await snapshotA();
    // B's slug stays: later tests confirm transfers with it.
    const input = { ...(inputs(t.b.id).updateWorkspaceProfileAction as Record<string, string>) };
    delete input.slug;
    expect(await action('updateWorkspaceProfileAction')(input)).toMatchObject({
      ok: true,
      data: { name: 'Cross-tenant probe', slug: t.b.slug, practiceCity: 'Probe City' },
    });
    expect(await snapshotA()).toEqual(before);
  });

  it('acceptInvitationAction with A’s token does not let ub into A', async () => {
    const before = await snapshotA();
    const result = await action('acceptInvitationAction')({ token: aInvitation.token });
    expect(result).toEqual({ ok: true, data: { status: 'rejected', reason: 'EMAIL_MISMATCH' } });
    expect(await snapshotA()).toEqual(before);
  });

  it('createWorkspaceAction and setLocaleAction touch only the caller’s own data', async () => {
    const before = await snapshotA();
    const created = (await action('createWorkspaceAction')({ name: t.a.name })) as {
      ok: boolean;
      data: { slug: string };
    };
    expect(created.ok).toBe(true);
    expect(created.data.slug).not.toBe(t.a.slug);
    expect(await snapshotA()).toEqual(before);

    updateUser.mockClear();
    await action('setLocaleAction')({ locale: 'ta' });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith(t.ub, { locale: 'ta' });
  });

  it('the workspace loader (resolveSlug) shows A’s slugs to ub as not found', async () => {
    const history = t.a.rows.workspace_slug_history?.slug ?? '';
    for (const slug of [t.a.slug, history]) {
      expect(await loadWorkspaceContext(slug)).toEqual({ kind: 'not-found' });
    }
    // uboth, a member of A, gets A.
    signInAs(t.uboth);
    const result = await loadWorkspaceContext(t.a.slug);
    expect(result.kind).toBe('ok');
  });
});
