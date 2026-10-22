// Cross-tenant server actions (#19, #209), against the real test database (run by
// `vitest.tenancy.config.ts`, which starts it; the default web config excludes this file). User `ub`
// owns workspace B and calls every server action with workspace A's ids: workspace actions answer
// FORBIDDEN for A's workspace and NOT_FOUND (or nothing) for A's member and invitation ids under B,
// and A's rows never change. The workspace loader shows A's slug to `ub` as not-found, which covers
// `resolveSlug` (caller-checked in the registry). Every exported action is listed in ACTIONS.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeTestDb, schema, testAppDb, withWorkspace } from '@causedeck/db/testing';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';

const state = vi.hoisted(() => ({ session: null as AppSession | null }));
const updateUser = vi.hoisted(() => vi.fn(() => Promise.resolve()));
// Better Auth's account endpoints (#289), answered from the real tables for the signed-in user;
// the mutating ones only record their calls.
const authApi = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listPasskeys: vi.fn(),
  revokeSession: vi.fn(() => Promise.resolve({ status: true })),
  deletePasskey: vi.fn(() => Promise.resolve({ status: true })),
  getSession: vi.fn(() => Promise.resolve({ user: { twoFactorEnabled: false } })),
  enableTwoFactor: vi.fn(() =>
    Promise.resolve({
      totpURI: 'otpauth://totp/CauseDeck:x?secret=JBSWY3DPEHPK3PXP',
      backupCodes: [],
    }),
  ),
  verifyTOTP: vi.fn(() => Promise.resolve({ headers: new Headers(), response: {} })),
}));

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
  getAuth: () => ({
    api: authApi,
    $context: Promise.resolve({ internalAdapter: { updateUser } }),
  }),
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
// The roster preview reads uploads from the app's object store (#434): an empty in-memory one.
vi.mock('../lib/storage.ts', async () => {
  const { createMemoryObjectStore } = await import('@causedeck/storage');
  const store = createMemoryObjectStore();
  return { objectStore: () => store };
});
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: vi.fn() }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock('@causedeck/core/runtime', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  recordAccountProfileUpdatedFor: vi.fn(() => Promise.resolve()),
}));
// The integration cards' flags are on, so B's own rotate reaches the service (#287).
vi.mock('@causedeck/flags/server', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isEnabled: vi.fn(() => Promise.resolve(true)),
}));
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
const roles = await import('../app/(app)/w/[slug]/settings/roles/actions.ts');
const privacy = await import('../app/(app)/w/[slug]/settings/privacy/actions.ts');
const integrations = await import('../app/(app)/w/[slug]/settings/integrations/actions.ts');
const activity = await import('../app/(app)/w/[slug]/activity/actions.ts');
const support = await import('../app/(app)/w/[slug]/settings/support/actions.ts');
const exports = await import('../app/(app)/w/[slug]/settings/export/actions.ts');
const danger = await import('../app/(app)/w/[slug]/settings/danger/actions.ts');
const courts = await import('../app/(app)/w/[slug]/courts/actions.ts');
const rosters = await import('../app/(app)/w/[slug]/courts/rosters/actions.ts');
const matters = await import('../app/(app)/w/[slug]/matters/actions.ts');
const matterWorkspace = await import('../app/(app)/w/[slug]/matters/[id]/actions.ts');
const matterPeople = await import('../app/(app)/w/[slug]/matters/[id]/people/actions.ts');
const { loadWorkspaceContext } = await import('../lib/workspace-loader.ts');

/** Keyset position newer than any row: the next page then starts at the newest event. */
const FAR_FUTURE = '9999-12-31T23:59:59.999999Z';
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
  updateAccountProfileAction: account,
  enableTwoFactorAction: account,
  verifyTwoFactorAction: account,
  deletePasskeyAction: account,
  revokeSessionAction: account,
  listNotificationsAction: notifications,
  markNotificationReadAction: notifications,
  markAllNotificationsReadAction: notifications,
  setNotificationPreferenceAction: preferences,
  setNotificationDigestAction: preferences,
  setCourtHoursQuietAction: preferences,
  setLockScreenDetailsAction: preferences,
  updateWorkspaceProfileAction: profile,
  updateRoleSettingsAction: roles,
  updateWorkspacePrivacyAction: privacy,
  rotateIntegrationTokenAction: integrations,
  loadMoreAuditAction: activity,
  verifyAuditEventAction: activity,
  grantSupportSessionAction: support,
  denySupportSessionAction: support,
  revokeSupportSessionAction: support,
  requestExportAction: exports,
  listExportsAction: exports,
  requestWorkspaceDeletionAction: danger,
  cancelWorkspaceDeletionAction: danger,
  requestAccountDeletionAction: account,
  createWorkspaceForumAction: courts,
  previewRosterImportAction: rosters,
  confirmRosterImportAction: rosters,
  dismissBenchChangeAlertAction: rosters,
  createMatterAction: matters,
  searchMattersAction: matters,
  updateMatterAction: matterWorkspace,
  setSensitiveAction: matterWorkspace,
  confirmNextDateAction: matterWorkspace,
  chooseNextDateSourceAction: matterWorkspace,
  upsertPersonAction: matterPeople,
  setRoleEdgeAction: matterPeople,
};

type Action = (raw: unknown) => Promise<unknown>;
const action = (name: string): Action => ACTIONS[name]?.[name] as Action;

let t: TwoTenants;
let aMember: { memberId: string; userId: string };
let aInvitation: { invitationId: string; token: string };
let aNotificationId: string;
let aAuditEvent: { id: string; createdAt: string };
let aSupportSessionId: string;
let aDeletionId: string;

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
    auditEvents: await tx
      .select({ id: schema.auditEvent.id })
      .from(schema.auditEvent)
      .orderBy(schema.auditEvent.id),
    notificationPrefs: await tx.select().from(schema.notificationPref),
    notificationSettings: await tx.select().from(schema.notificationSetting),
    supportSessions: await tx
      .select()
      .from(schema.supportSession)
      .orderBy(schema.supportSession.id),
    exportJobs: await tx.select().from(schema.exportJob).orderBy(schema.exportJob.id),
    deletionJobs: await tx.select().from(schema.deletionJob).orderBy(schema.deletionJob.id),
    integrations: await tx
      .select({
        kind: schema.workspaceIntegration.kind,
        tokenHash: schema.workspaceIntegration.tokenHash,
        rotatedAt: schema.workspaceIntegration.rotatedAt,
      })
      .from(schema.workspaceIntegration)
      .orderBy(schema.workspaceIntegration.kind),
    // The catalogue and A's own forums (#402).
    forums: await tx
      .select({
        id: schema.forum.id,
        code: schema.forum.code,
        workspaceId: schema.forum.workspaceId,
      })
      .from(schema.forum)
      .orderBy(schema.forum.id),
    // A's matters (#388).
    matters: await tx
      .select({
        id: schema.matter.id,
        title: schema.matter.title,
        // The matter workspace (#390): synopsis, sensitive flag and last change.
        sensitive: schema.matter.sensitive,
        synopsis: schema.matter.synopsis,
        updatedAt: schema.matter.updatedAt,
      })
      .from(schema.matter)
      .orderBy(schema.matter.id),
    // A's listings: the next date and its confirmation (#390).
    listings: await tx
      .select({
        id: schema.listing.id,
        canonical: schema.listing.canonical,
        confirmationState: schema.listing.confirmationState,
        listDate: schema.listing.listDate,
      })
      .from(schema.listing)
      .orderBy(schema.listing.id),
    // A's people and their roles (#393).
    persons: await tx
      .select({
        id: schema.person.id,
        name: schema.person.name,
        kind: schema.person.kind,
        aliases: schema.person.aliases,
        contact: schema.person.contact,
      })
      .from(schema.person)
      .orderBy(schema.person.id),
    roleEdges: await tx.select().from(schema.roleEdge).orderBy(schema.roleEdge.id),
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
  const ae = t.a.rows.audit_event;
  if (!ae?.auditEventId) throw new Error('seed rows');
  // A's real audit event as A's owner's feed shows it (`createdAt` ISO 8601 UTC, microseconds).
  const { queryAudit } = await import('@causedeck/core/audit');
  const feed = await queryAudit({ db: testAppDb(), workspaceId: t.a.id, userId: t.ua }, {});
  const event = feed.events.find((item) => item.id === ae.auditEventId);
  if (!event) throw new Error('seed rows');
  aAuditEvent = { id: ae.auditEventId, createdAt: event.createdAt };
  const ss = t.a.rows.support_session;
  if (!ss?.id) throw new Error('seed rows');
  aSupportSessionId = ss.id;
  const dj = t.a.rows.deletion_job;
  if (!dj?.id) throw new Error('seed rows');
  aDeletionId = dj.id;
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
    updateRoleSettingsAction: {
      workspaceId,
      advocatesCanInvite: false,
      ownersSeeRestrictedMatters: false,
    },
    updateWorkspacePrivacyAction: {
      workspaceId,
      sensitiveDefaultRestricted: false,
      retentionAudioDays: 7,
    },
    rotateIntegrationTokenAction: { workspaceId, kind: 'ics_feed' },
    // A page position past every row, so a leak would return A's real audit event.
    loadMoreAuditAction: {
      workspaceId,
      cursor: Buffer.from(JSON.stringify({ t: FAR_FUTURE, i: aAuditEvent.id }), 'utf8').toString(
        'base64url',
      ),
    },
    verifyAuditEventAction: {
      workspaceId,
      eventId: aAuditEvent.id,
      createdAt: aAuditEvent.createdAt,
    },
    // A's pending support request (#313): ub, owner of B, may not grant, deny or end it.
    grantSupportSessionAction: { workspaceId, sessionId: aSupportSessionId },
    denySupportSessionAction: { workspaceId, sessionId: aSupportSessionId },
    revokeSupportSessionAction: { workspaceId, sessionId: aSupportSessionId },
    // Lifecycle (#305): ub, owner of B, may not export, delete or cancel A's deletion.
    requestExportAction: { workspaceId },
    listExportsAction: { workspaceId },
    requestWorkspaceDeletionAction: { workspaceId, confirmName: t.a.name },
    cancelWorkspaceDeletionAction: { workspaceId, jobId: aDeletionId },
    // Courts (#402): ub, owner of B, may not add a forum to A.
    createWorkspaceForumAction: {
      workspaceId,
      code: `xt.probe-${workspaceId.slice(0, 8)}`,
      name: 'Cross-tenant probe forum',
      jurisdictionKind: 'other',
      city: 'Probe City',
      primaryLanguage: 'en',
    },
    // Rosters (#434): ub, owner of B, may not parse A's upload, confirm a roster on A's forum or
    // dismiss A's bench-change alert.
    previewRosterImportAction: {
      workspaceId,
      blobId: t.a.rows.blob?.id,
      forumCode: 'xt.probe-roster',
    },
    confirmRosterImportAction: {
      workspaceId,
      forumId: t.a.rows.bench_roster?.forumId,
      effectiveFrom: '2027-03-01',
      entries: [{ hallNo: '1', judges: ['Justice Probe'] }],
      supersedeCurrent: true,
    },
    dismissBenchChangeAlertAction: {
      workspaceId,
      alertId: t.a.rows.bench_change_alert?.alertId,
    },
    // Matters (#388): ub, owner of B, may not add a matter to A or search A's matters.
    createMatterAction: { workspaceId, title: 'Cross-tenant probe matter' },
    searchMattersAction: { workspaceId, q: 'XT Matter' },
    // Matter workspace (#390): ub may not change A's matter or resolve A's next dates.
    updateMatterAction: {
      workspaceId,
      matterId: t.a.rows.matter?.matterId,
      patch: { synopsis: 'Cross-tenant probe synopsis' },
    },
    setSensitiveAction: { workspaceId, matterId: t.a.rows.matter?.matterId, sensitive: true },
    confirmNextDateAction: { workspaceId, listingId: t.a.rows.listing?.listingId },
    chooseNextDateSourceAction: {
      workspaceId,
      currentListingId: t.a.rows.listing?.listingId,
      proposedListingId: t.a.rows.listing?.listingId,
      choice: 'current',
    },
    upsertPersonAction: {
      workspaceId,
      matterId: t.a.rows.matter?.matterId,
      person: {
        personId: t.a.rows.person?.personId,
        name: 'Probe (fictional)',
        kind: 'client',
        contact: { phone: '0' },
      },
    },
    setRoleEdgeAction: {
      workspaceId,
      matterId: t.a.rows.matter?.matterId,
      personId: t.a.rows.person?.personId,
      kind: 'represents',
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
      const result = await action(name)(input);
      expect(code(result), name).toBe('FORBIDDEN');
      expect(result, name).not.toHaveProperty('data');
    }
    expect(await snapshotA()).toEqual(before);
  });

  it('the audit actions answer A’s owner with A’s event, so the denial for ub is meaningful', async () => {
    signInAs(t.ua);
    const all = inputs(t.a.id);
    const page = (await action('loadMoreAuditAction')(all.loadMoreAuditAction)) as {
      ok: boolean;
      data: { events: { id: string }[] };
    };
    expect(page.ok).toBe(true);
    expect(page.data.events.map((event) => event.id)).toContain(aAuditEvent.id);
    expect(await action('verifyAuditEventAction')(all.verifyAuditEventAction)).toEqual({
      ok: true,
      data: 'verified',
    });
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

  it('under B’s own workspace, A’s support session is not found and stays pending', async () => {
    const before = await snapshotA();
    const all = inputs(t.b.id);
    for (const name of [
      'grantSupportSessionAction',
      'denySupportSessionAction',
      'revokeSupportSessionAction',
    ]) {
      expect(code(await action(name)(all[name])), name).toBe('NOT_FOUND');
    }
    expect(await snapshotA()).toEqual(before);
    expect(before.supportSessions.find((row) => row.id === aSupportSessionId)?.status).toBe(
      'requested',
    );
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

  it('updateRoleSettingsAction under B’s own workspace changes only B', async () => {
    const before = await snapshotA();
    const input = inputs(t.b.id).updateRoleSettingsAction;
    expect(await action('updateRoleSettingsAction')(input)).toMatchObject({
      ok: true,
      data: { advocatesCanInvite: false, ownersSeeRestrictedMatters: false },
    });
    expect(await snapshotA()).toEqual(before);
    // Put B back to the defaults for the tests that follow.
    await action('updateRoleSettingsAction')({
      workspaceId: t.b.id,
      advocatesCanInvite: true,
      ownersSeeRestrictedMatters: true,
    });
  });

  it('updateWorkspacePrivacyAction under B’s own workspace changes only B', async () => {
    const before = await snapshotA();
    const privacyOfA = () =>
      withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
        tx
          .select({
            sensitiveDefaultRestricted: schema.workspaceSettings.sensitiveDefaultRestricted,
            retentionAudioDays: schema.workspaceSettings.retentionAudioDays,
          })
          .from(schema.workspaceSettings),
      );
    const privacyBefore = await privacyOfA();
    const input = inputs(t.b.id).updateWorkspacePrivacyAction;
    expect(await action('updateWorkspacePrivacyAction')(input)).toMatchObject({
      ok: true,
      data: { indiaOnlyAi: true, sensitiveDefaultRestricted: false, retentionAudioDays: 7 },
    });
    expect(await snapshotA()).toEqual(before);
    expect(await privacyOfA()).toEqual(privacyBefore);
    // Put B back to the defaults for the tests that follow.
    await action('updateWorkspacePrivacyAction')({
      workspaceId: t.b.id,
      sensitiveDefaultRestricted: true,
      retentionAudioDays: 30,
    });
  });

  it('rotateIntegrationTokenAction under B’s own workspace changes only B', async () => {
    const before = await snapshotA();
    expect(before.integrations).toHaveLength(1);
    const input = inputs(t.b.id).rotateIntegrationTokenAction;
    const result = (await action('rotateIntegrationTokenAction')(input)) as {
      ok: boolean;
      data: { kind: string; value: string };
    };
    expect(result.ok).toBe(true);
    expect(result.data.kind).toBe('ics_feed');
    expect(result.data.value).toMatch(/^http:\/\/localhost:3000\/api\/ics\/[\w-]{43}$/);
    expect(await snapshotA()).toEqual(before);
  });

  it('createWorkspaceForumAction under B’s own workspace adds the forum to B only (#402)', async () => {
    const before = await snapshotA();
    const code = `xt.probe-${randomUUID().slice(0, 8)}`;
    const input = { ...(inputs(t.b.id).createWorkspaceForumAction as object), code };
    expect(await action('createWorkspaceForumAction')(input)).toMatchObject({
      ok: true,
      data: { code, court: 'Cross-tenant probe forum', seat: 'Probe City' },
    });
    expect(await snapshotA()).toEqual(before);
    expect(before.forums.map((row) => row.code)).not.toContain(code);
    const inB = await withWorkspace(testAppDb(), { workspaceId: t.b.id }, (tx) =>
      tx
        .select({
          code: schema.forum.code,
          workspaceId: schema.forum.workspaceId,
          adapterLevel: schema.forum.adapterLevel,
        })
        .from(schema.forum),
    );
    expect(inB.filter((row) => row.code === code)).toEqual([
      { code, workspaceId: t.b.id, adapterLevel: 'A0' },
    ]);
  });

  it('matter actions under B’s own workspace create in B only and never find A’s matters (#388)', async () => {
    const before = await snapshotA();
    expect(before.matters.length).toBeGreaterThan(0);
    const own = inputs(t.b.id);
    const created = (await action('createMatterAction')(own.createMatterAction)) as {
      ok: boolean;
      data: { id: string; title: string };
    };
    expect(created).toMatchObject({ ok: true, data: { title: 'Cross-tenant probe matter' } });
    const inB = await withWorkspace(testAppDb(), { workspaceId: t.b.id }, (tx) =>
      tx
        .select({ id: schema.matter.id, workspaceId: schema.matter.workspaceId })
        .from(schema.matter),
    );
    expect(inB.find((row) => row.id === created.data.id)).toEqual({
      id: created.data.id,
      workspaceId: t.b.id,
    });
    const found = (await action('searchMattersAction')(own.searchMattersAction)) as {
      ok: boolean;
      data: { id: string }[];
    };
    expect(found.ok).toBe(true);
    const aIds = new Set(before.matters.map((row) => row.id));
    expect(found.data.filter((hit) => aIds.has(hit.id))).toEqual([]);
    expect(await snapshotA()).toEqual(before);
  });

  it('matter workspace actions under B’s own workspace find none of A’s matter or listings (#390)', async () => {
    const before = await snapshotA();
    const own = inputs(t.b.id);
    for (const name of [
      'updateMatterAction',
      'setSensitiveAction',
      'confirmNextDateAction',
      'chooseNextDateSourceAction',
      // People tab (#393): A's matter and person
      'upsertPersonAction',
      'setRoleEdgeAction',
    ]) {
      const result = await action(name)(own[name]);
      expect(['NOT_FOUND', 'FORBIDDEN'], name).toContain(code(result));
      expect(result, name).not.toHaveProperty('data');
    }
    expect(await snapshotA()).toEqual(before);
  });

  it('roster actions under B’s own workspace find none of A’s upload, forum or alert (#434)', async () => {
    const before = await snapshotA();
    const aAlerts = () =>
      withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
        tx.select().from(schema.benchChangeAlert).orderBy(schema.benchChangeAlert.id),
      );
    const alertsBefore = await aAlerts();
    const bForums = await withWorkspace(testAppDb(), { workspaceId: t.b.id }, (tx) =>
      tx.select({ id: schema.forum.id, code: schema.forum.code }).from(schema.forum),
    );
    const bForum = bForums.find((f) => f.id === t.b.rows.bench_roster?.forumId);
    const own = inputs(t.b.id);
    for (const [name, input] of [
      [
        'previewRosterImportAction',
        { ...(own.previewRosterImportAction as object), forumCode: bForum?.code },
      ],
      ['confirmRosterImportAction', own.confirmRosterImportAction],
      ['dismissBenchChangeAlertAction', own.dismissBenchChangeAlertAction],
    ] as const) {
      expect(await action(name)(input), name).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    expect(await snapshotA()).toEqual(before);
    expect(await aAlerts()).toEqual(alertsBefore);
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

  it('account actions (#289) never reach ua’s sessions, passkeys or user row', async () => {
    const db = testAppDb();
    const [aSession] = await db
      .insert(schema.session)
      .values({
        userId: t.ua,
        token: `xt-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: schema.session.id, token: schema.session.token });
    const [aPasskey] = await db
      .insert(schema.passkey)
      .values({
        userId: t.ua,
        publicKey: 'pk',
        credentialID: crypto.randomUUID(),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      })
      .returning({ id: schema.passkey.id });
    if (!aSession || !aPasskey) throw new Error('seed account rows');
    const mine = <T extends { userId: string }>(rows: T[]) =>
      rows.filter((row) => row.userId === state.session?.user.id);
    authApi.listSessions.mockImplementation(async () =>
      mine(await db.select().from(schema.session)),
    );
    authApi.listPasskeys.mockImplementation(async () =>
      mine(await db.select().from(schema.passkey)),
    );

    signInAs(t.ub);
    expect(code(await action('revokeSessionAction')({ sessionId: aSession.id }))).toBe('FORBIDDEN');
    expect(code(await action('deletePasskeyAction')({ id: aPasskey.id }))).toBe('FORBIDDEN');
    expect(authApi.revokeSession).not.toHaveBeenCalled();
    expect(authApi.deletePasskey).not.toHaveBeenCalled();

    updateUser.mockClear();
    expect(await action('updateAccountProfileAction')({ name: 'Renamed by B' })).toMatchObject({
      ok: true,
    });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith(t.ub, { name: 'Renamed by B' });

    // TOTP setup and verification act on the caller's own session only (no target id at all).
    expect(await action('enableTwoFactorAction')({})).toMatchObject({ ok: true });
    expect(await action('verifyTwoFactorAction')({ code: '123456' })).toMatchObject({ ok: true });

    // Account deletion (#305) acts on the caller's own account only: never on ua's.
    const deletion = await action('requestAccountDeletionAction')({});
    expect(deletion).toMatchObject({ ok: false });
    const deletions = await db
      .select({ userId: schema.deletionJob.userId })
      .from(schema.deletionJob);
    expect(deletions.filter((row) => row.userId === t.ua)).toEqual([]);

    const sessions = await db.select().from(schema.session);
    expect(sessions.some((row) => row.id === aSession.id)).toBe(true);
    const passkeys = await db.select().from(schema.passkey);
    expect(passkeys.some((row) => row.id === aPasskey.id)).toBe(true);
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
