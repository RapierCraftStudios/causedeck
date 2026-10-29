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
  serverEnv: () => ({
    APP_URL: 'http://localhost:3000',
    EMAIL_PROVIDER: 'console',
    BETTER_AUTH_SECRET: { reveal: () => 'cross-tenant-test-secret-0123456789' },
    KEK_BASE64: { reveal: () => Buffer.alloc(32, 7).toString('base64') },
  }),
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
const welcome = await import('../app/(app)/w/[slug]/welcome/actions.ts');
const onboarding = await import('../app/(app)/onboarding/actions.ts');
const account = await import('../app/(app)/account/actions.ts');
const notifications = await import('../app/(app)/w/[slug]/notifications/actions.ts');
const preferences = await import('../app/(app)/w/[slug]/settings/notifications/actions.ts');
const whatsappLink =
  await import('../app/(app)/w/[slug]/settings/notifications/whatsapp-actions.ts');
const reminders = await import('../app/(app)/w/[slug]/settings/notifications/reminders-actions.ts');
const news = await import('../app/(app)/w/[slug]/news/actions.ts');
const drafts = await import('../app/(app)/w/[slug]/drafts/actions.ts');
const profile = await import('../app/(app)/w/[slug]/settings/profile/actions.ts');
const roles = await import('../app/(app)/w/[slug]/settings/roles/actions.ts');
const sso = await import('../app/(app)/w/[slug]/settings/sso/actions.ts');
const privacy = await import('../app/(app)/w/[slug]/settings/privacy/actions.ts');
const integrations = await import('../app/(app)/w/[slug]/settings/integrations/actions.ts');
const emailIntake = await import('../app/(app)/w/[slug]/settings/integrations/email/actions.ts');
const activity = await import('../app/(app)/w/[slug]/activity/actions.ts');
const support = await import('../app/(app)/w/[slug]/settings/support/actions.ts');
const exports = await import('../app/(app)/w/[slug]/settings/export/actions.ts');
const courtWatch = await import('../app/(app)/w/[slug]/settings/court-watch/actions.ts');
const caseWatch = await import('../app/(app)/w/[slug]/settings/case-watch/actions.ts');
const danger = await import('../app/(app)/w/[slug]/settings/danger/actions.ts');
const courts = await import('../app/(app)/w/[slug]/courts/actions.ts');
const rosters = await import('../app/(app)/w/[slug]/courts/rosters/actions.ts');
const portfolioActions = await import('../app/(app)/w/[slug]/portfolio/actions.ts');
const matters = await import('../app/(app)/w/[slug]/matters/actions.ts');
const matterWorkspace = await import('../app/(app)/w/[slug]/matters/[id]/actions.ts');
const proceedingsTab = await import('../app/(app)/w/[slug]/matters/[id]/proceedings/actions.ts');
const matterPeople = await import('../app/(app)/w/[slug]/matters/[id]/people/actions.ts');
const peopleContacts = await import('../app/(app)/w/[slug]/people/actions.ts');
const enquiries = await import('../app/(app)/w/[slug]/people/enquiries/actions.ts');
const limitation = await import('../app/(app)/w/[slug]/limitation/actions.ts');
const feeActions = await import('../app/(app)/w/[slug]/invoices/actions.ts');
const research = await import('../app/(app)/w/[slug]/matters/[id]/research/actions.ts');
const researchSettings = await import('../app/(app)/w/[slug]/settings/research/actions.ts');
const draftStudio = await import('../app/(app)/w/[slug]/drafts/[id]/actions.ts');
const draftChecks = await import('../app/(app)/w/[slug]/drafts/[id]/checks-actions.ts');
const draftPrecedents = await import('../app/(app)/w/[slug]/drafts/[id]/precedent-actions.ts');
const draftFactcheck = await import('../app/(app)/w/[slug]/drafts/[id]/factcheck-actions.ts');
const hearingOutcome =
  await import('../app/(app)/w/[slug]/hearings/[hearingId]/outcome/actions.ts');
const briefSheet = await import('../app/(app)/w/[slug]/briefs/[listing-id]/actions.ts');
const inbox = await import('../app/(app)/w/[slug]/inbox/actions.ts');
const obligations = await import('../app/(app)/w/[slug]/obligations/actions.ts');
const attention = await import('../app/(app)/w/[slug]/matters/_components/attention-actions.ts');
const memory = await import('../app/(app)/w/[slug]/memory/actions.ts');
const m5 = await import('../app/(app)/w/[slug]/memory/m5-actions.ts');
const outward = await import('../app/(app)/w/[slug]/_outward/actions.ts');
const planActions = await import('../app/(app)/w/[slug]/tomorrow/plan/actions.ts');
const importer = await import('../app/(app)/w/[slug]/import/actions.ts');
const discovery = await import('../app/(app)/w/[slug]/onboarding/actions.ts');
const calendar = await import('../app/(app)/w/[slug]/settings/integrations/calendar/actions.ts');
const courtDay = await import('../app/(app)/w/[slug]/_court-day/actions.ts');
const offlineActions = await import('../app/(app)/w/[slug]/_offline/actions.ts');
const shareActions = await import('../app/(public)/share/[token]/actions.ts');
const continuityActions = await import('../app/(app)/w/[slug]/matters/[id]/_continuity/actions.ts');
const briefShareActions = await import('../app/(app)/w/[slug]/briefs/actions.ts');
const { loadWorkspaceContext } = await import('../lib/workspace-loader.ts');

/** Keyset position newer than any row: the next page then starts at the newest event. */
const FAR_FUTURE = '9999-12-31T23:59:59.999999Z';
const XT_ID = '00000000-0000-4000-8000-0000000000a1';
/** A hall id no tenant owns: the court-day marker actions must refuse it, never write. */
const PROBE_HALL_ID = '00000000-0000-4000-8000-0000000000a1';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));

/** Every exported server action and the module it comes from. */
const ACTIONS: Record<string, Record<string, unknown>> = {
  inviteMembersAction: members,
  provisionMembersCsvAction: members,
  changeRoleAction: members,
  openWorkAction: members,
  removeMemberAction: members,
  resendInvitationAction: members,
  revokeInvitationAction: members,
  prepareTransferAction: members,
  confirmTransferAction: members,
  acceptInvitationAction: invite,
  importSharedBriefAction: shareActions,
  pullCourtDaySnapshotAction: offlineActions,
  pushOutboxAction: offlineActions,
  createBriefShareAction: briefShareActions,
  revokeBriefShareAction: briefShareActions,
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
  getReminderPreferencesAction: reminders,
  setReminderPreferencesAction: reminders,
  requestWhatsAppOtpAction: whatsappLink,
  verifyWhatsAppOtpAction: whatsappLink,
  setWhatsAppCategoriesAction: whatsappLink,
  unlinkWhatsAppAction: whatsappLink,
  getWhatsAppLinkAction: whatsappLink,
  saveNewsPreferencesAction: news,
  createDraftAction: drafts,
  updateWorkspaceProfileAction: profile,
  updateRoleSettingsAction: roles,
  saveSsoProviderAction: sso,
  deleteSsoProviderAction: sso,
  verifySsoDomainAction: sso,
  requestClerkSetupApprovalAction: welcome,
  approveClerkSetupAction: welcome,
  updateWorkspacePrivacyAction: privacy,
  setAllowEvalReuseAction: privacy,
  rotateIntegrationTokenAction: integrations,
  createIntakeAddressAction: emailIntake,
  rotateIntakeAddressAction: emailIntake,
  revokeIntakeAddressAction: emailIntake,
  addIntakeAllowlistEntryAction: emailIntake,
  removeIntakeAllowlistEntryAction: emailIntake,
  enableEmailChannelAction: emailIntake,
  loadMoreAuditAction: activity,
  verifyAuditEventAction: activity,
  loadMoreActivitiesAction: activity,
  previewActivityUndoAction: activity,
  undoFeedActivityAction: activity,
  undoCaptureAction: activity,
  reassignFeedCaptureAction: activity,
  grantSupportSessionAction: support,
  denySupportSessionAction: support,
  revokeSupportSessionAction: support,
  requestExportAction: exports,
  listExportsAction: exports,
  listCourtWatchesAction: courtWatch,
  addCourtWatchAction: courtWatch,
  removeCourtWatchAction: courtWatch,
  listCaseWatchesAction: caseWatch,
  addCaseWatchAction: caseWatch,
  removeCaseWatchAction: caseWatch,
  refreshCaseStatusAction: caseWatch,
  recordDeviceStatusAction: caseWatch,
  requestWorkspaceDeletionAction: danger,
  cancelWorkspaceDeletionAction: danger,
  requestAccountDeletionAction: account,
  createWorkspaceForumAction: courts,
  previewRosterImportAction: rosters,
  confirmRosterImportAction: rosters,
  dismissBenchChangeAlertAction: rosters,
  createPortfolioAction: portfolioActions,
  importPortfolioAction: portfolioActions,
  exportPortfolioCsvAction: portfolioActions,
  createMatterAction: matters,
  searchMattersAction: matters,
  checkConflictsAction: matters,
  updateMatterAction: matterWorkspace,
  setSensitiveAction: matterWorkspace,
  confirmNextDateAction: matterWorkspace,
  saveDraftAction: draftStudio,
  restoreDraftVersionAction: draftStudio,
  runChecksAction: draftChecks,
  acknowledgeUnverifiedAction: draftChecks,
  applyFixAction: draftChecks,
  exportDraftAction: draftChecks,
  runFactCheckAction: draftFactcheck,
  checkFactsLiveAction: draftFactcheck,
  ignoreFactAction: draftFactcheck,
  markAssertionAction: draftFactcheck,
  acknowledgeFactCheckAction: draftFactcheck,
  recordFactFixAction: draftFactcheck,
  downloadDraftExportAction: draftChecks,
  searchPrecedentsForBlockAction: draftPrecedents,
  proposePrecedentAction: draftPrecedents,
  addTagAction: research,
  confirmOutcomeAction: hearingOutcome,
  markPreparedAction: briefSheet,
  generateHandoverAction: continuityActions,
  saveHandoverAction: continuityActions,
  listHandoversAction: continuityActions,
  acknowledgeHandoverAction: continuityActions,
  recordViewAction: continuityActions,
  whatChangedAction: continuityActions,
  setCarryItemAction: briefSheet,
  setBriefNoteAction: briefSheet,
  setPrintNotesAction: briefSheet,
  recordManualOutcomeAction: hearingOutcome,
  confirmTagAction: research,
  dismissTagAction: research,
  createNoteAction: research,
  updateNoteAction: research,
  deleteNoteAction: research,
  addAuthorityAction: research,
  removeAuthorityAction: research,
  setAuthorityPinnedAction: research,
  saveProviderTemplateAction: researchSettings,
  removeProviderTemplateAction: researchSettings,
  chooseNextDateSourceAction: matterWorkspace,
  reportRecordErrorAction: matterWorkspace,
  createProceedingAction: proceedingsTab,
  updateProceedingAction: proceedingsTab,
  transitionProceedingAction: proceedingsTab,
  linkProceedingsAction: proceedingsTab,
  findDuplicateProceedingsAction: proceedingsTab,
  previewMergeAction: proceedingsTab,
  previewSplitAction: proceedingsTab,
  mergeMattersAction: proceedingsTab,
  undoMergeAction: proceedingsTab,
  splitMatterAction: proceedingsTab,
  undoSplitAction: proceedingsTab,
  upsertPersonAction: matterPeople,
  setRoleEdgeAction: matterPeople,
  createContactAction: peopleContacts,
  updateContactAction: peopleContacts,
  undoContactChangeAction: peopleContacts,
  linkContactToMatterAction: peopleContacts,
  archiveContactAction: peopleContacts,
  logEnquiryAction: enquiries,
  updateEnquiryAction: enquiries,
  runConflictCheckAction: enquiries,
  acceptEnquiryAction: enquiries,
  closeEnquiryAction: enquiries,
  computeLimitationAction: limitation,
  confirmLimitationAction: limitation,
  createFeeAgreementAction: feeActions,
  setFeeAgreementStatusAction: feeActions,
  previewInvoiceAction: feeActions,
  saveInvoiceDraftAction: feeActions,
  discardInvoiceDraftAction: feeActions,
  issueInvoiceAction: feeActions,
  enableChannelAction: inbox,
  discardCaptureAction: inbox,
  pinCaptureAction: inbox,
  deleteRecordingAction: inbox,
  startImportBatchAction: importer,
  addImportFilesAction: importer,
  importProgressAction: importer,
  buildImportPlanAction: importer,
  getImportPlanAction: importer,
  saveImportPlanEditsAction: importer,
  applyImportPlanAction: importer,
  undoImportBatchAction: importer,
  discoverAdvocateCasesAction: discovery,
  discoveryProgressAction: discovery,
  recordOnboardingStepAction: discovery,
  createCalendarFeedAction: calendar,
  rotateCalendarFeedAction: calendar,
  revokeCalendarFeedAction: calendar,
  setCalendarFeedPartiesAction: calendar,
  confirmCalendarEventAction: calendar,
  skipCalendarEventAction: calendar,
  noteCalendarEventAction: calendar,
  acceptProposalAction: inbox,
  editAcceptProposalAction: inbox,
  dismissProposalAction: inbox,
  undoActivityAction: inbox,
  reassignCaptureAction: inbox,
  keepAsAttachmentAction: inbox,
  assignAppearanceAction: planActions,
  acceptSuggestionAction: planActions,
  acceptAllSuggestionsAction: planActions,
  outcomesLiveAction: planActions,
  typeKeyLineAction: inbox,
  markSentAction: inbox,
  listAttentionAction: attention,
  snoozeFlagAction: attention,
  dismissFlagAction: attention,
  liftSnoozeAction: attention,
  closeObligationAction: obligations,
  rescheduleAction: obligations,
  reassignAction: obligations,
  addObligationAction: obligations,
  useNextStepAction: obligations,
  confirmAction: memory,
  dismissAction: memory,
  editAction: memory,
  deleteAction: memory,
  pauseAction: memory,
  pauseAllAction: memory,
  addNoteAction: memory,
  usageAction: memory,
  completeReviewAction: memory,
  confirmPrecedentAction: m5,
  dismissPrecedentAction: m5,
  proposePlaybookAction: m5,
  confirmPlaybookAction: m5,
  deletePlaybookAction: m5,
  retirePrecedentAction: m5,
  deletePrecedentAction: m5,
  composeDraftAction: outward,
  saveDraftEditAction: outward,
  markDraftSharedAction: outward,
  setCurrentItemAction: courtDay,
  clearCurrentItemAction: courtDay,
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
/** The matter of A's seeded proceeding: a second matter of A, besides `rows.matter`. */
let aOtherMatterId: string;

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
      .select({
        id: schema.member.id,
        role: schema.member.role,
        status: schema.member.status,
        clerkSetupStatus: schema.member.clerkSetupStatus,
      })
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
    // A's WhatsApp links and pending codes (#681): no web action of B may touch them.
    whatsappLinks: await tx.select().from(schema.whatsappLink).orderBy(schema.whatsappLink.id),
    whatsappChallenges: await tx
      .select()
      .from(schema.whatsappOtpChallenge)
      .orderBy(schema.whatsappOtpChallenge.id),
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
    // A's API keys (#624): no web action may issue, revoke or touch one.
    apiKeys: await tx
      .select({
        id: schema.apiKey.id,
        tokenHash: schema.apiKey.tokenHash,
        revokedAt: schema.apiKey.revokedAt,
      })
      .from(schema.apiKey)
      .orderBy(schema.apiKey.id),
    // A's intake addresses, allow-list and messages (#54).
    intakeAddresses: await tx.select().from(schema.intakeAddress).orderBy(schema.intakeAddress.id),
    intakeAllowlist: await tx
      .select()
      .from(schema.intakeAllowlist)
      .orderBy(schema.intakeAllowlist.id),
    intakeMessages: await tx.select().from(schema.intakeMessage).orderBy(schema.intakeMessage.id),
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
    // A's proceedings and their links (#392): identifiers, state, matter and last change.
    proceedings: await tx
      .select({
        id: schema.proceeding.id,
        matterId: schema.proceeding.matterId,
        state: schema.proceeding.state,
        number: schema.proceeding.number,
        year: schema.proceeding.year,
        updatedAt: schema.proceeding.updatedAt,
      })
      .from(schema.proceeding)
      .orderBy(schema.proceeding.id),
    proceedingLinks: await tx
      .select({
        id: schema.proceedingLink.id,
        kind: schema.proceedingLink.kind,
        fromProceedingId: schema.proceedingLink.fromProceedingId,
        toProceedingId: schema.proceedingLink.toProceedingId,
      })
      .from(schema.proceedingLink)
      .orderBy(schema.proceedingLink.id),
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
  const proceedingId = t.a.rows.proceeding?.proceedingId;
  if (!proceedingId) throw new Error('seed rows');
  const rows = await withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
    tx
      .select({ id: schema.proceeding.id, matterId: schema.proceeding.matterId })
      .from(schema.proceeding),
  );
  const row = rows.find((r) => r.id === proceedingId);
  if (!row) throw new Error('seed rows');
  aOtherMatterId = row.matterId;
});

beforeEach(() => {
  signInAs(t.ub);
});

afterAll(closeTestDb);

/** Inputs naming workspace `workspaceId` with A's target ids. */
function inputs(workspaceId: string): Record<string, unknown> {
  return {
    inviteMembersAction: { workspaceId, emails: ['xt-probe@example.test'], role: 'junior' },
    provisionMembersCsvAction: {
      workspaceId,
      csv: 'email,role\nxt-probe-csv@example.test,viewer\n',
      dryRun: false,
    },
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
    getReminderPreferencesAction: { workspaceId },
    setReminderPreferencesAction: {
      workspaceId,
      evening: { time: '21:00', channels: { in_app: true, push: false, email: false } },
      morning: { channels: { in_app: true, push: false, email: true } },
      outcome_missing: { delayMinutes: 60, channels: { in_app: true, push: true, email: false } },
    },
    requestWhatsAppOtpAction: { workspaceId, e164: '+919812345678', consent: true },
    verifyWhatsAppOtpAction: { workspaceId, code: '000000' },
    setWhatsAppCategoriesAction: { workspaceId, categories: ['court.board'] },
    setCurrentItemAction: {
      workspaceId,
      hallId: PROBE_HALL_ID,
      listDate: '2030-01-02',
      currentItem: 3,
    },
    clearCurrentItemAction: { workspaceId, hallId: PROBE_HALL_ID, listDate: '2030-01-02' },
    // Offline pull and push (#743): ub may not pull A's days nor push edits to A's matters.
    pullCourtDaySnapshotAction: { workspaceId, from: '2030-01-01', to: '2030-01-07' },
    pushOutboxAction: {
      workspaceId,
      items: [
        {
          key: 'xt-probe-date',
          kind: 'next_date',
          proceedingId: t.a.rows.proceeding?.proceedingId,
          date: '2031-05-05',
          expectedCanonicalDate: null,
        },
        {
          key: 'xt-probe-note',
          kind: 'brief_note',
          listingId: t.a.rows.listing?.listingId,
          note: 'Cross-tenant probe note',
        },
      ],
    },
    unlinkWhatsAppAction: { workspaceId },
    getWhatsAppLinkAction: { workspaceId },
    saveNewsPreferencesAction: {
      workspaceId,
      practiceAreas: ['tax'],
      forums: [],
      digestTime: '08:00',
    },
    updateWorkspaceProfileAction: {
      workspaceId,
      name: 'Cross-tenant probe',
      kind: 'chamber',
      timezone: 'UTC',
      locale: 'kn',
      practiceCity: 'Probe City',
      slug: `xt-probe-${workspaceId.slice(0, 8)}`,
    },
    requestClerkSetupApprovalAction: { workspaceId },
    approveClerkSetupAction: { workspaceId, memberId: randomUUID() },
    updateRoleSettingsAction: {
      workspaceId,
      advocatesCanInvite: false,
      ownersSeeRestrictedMatters: false,
    },
    saveSsoProviderAction: {
      workspaceId,
      protocol: 'oidc',
      issuer: 'https://idp.example.com',
      domain: `xt-${workspaceId.slice(0, 8)}.example.com`,
      enabled: false,
      settings: { clientId: 'probe', clientSecret: 'probe-secret' },
    },
    deleteSsoProviderAction: { workspaceId, providerId: '00000000-0000-4000-8000-00000000d0d0' },
    verifySsoDomainAction: { workspaceId, providerId: '00000000-0000-4000-8000-00000000d0d0' },
    updateWorkspacePrivacyAction: {
      workspaceId,
      sensitiveDefaultRestricted: false,
      retentionAudioDays: 7,
    },
    // Eval reuse consent (#558): ub, owner of B, may not opt A in.
    setAllowEvalReuseAction: { workspaceId, allowEvalReuse: true },
    rotateIntegrationTokenAction: { workspaceId, kind: 'ics_feed' },
    // Email intake (#54): ub, owner of B, may not create, rotate or revoke an address, edit the
    // allow-list or enable the email channel on A.
    createIntakeAddressAction: { workspaceId },
    rotateIntakeAddressAction: { workspaceId },
    revokeIntakeAddressAction: { workspaceId, addressId: t.a.rows.intake_address?.id },
    addIntakeAllowlistEntryAction: {
      workspaceId,
      pattern: 'probe.court.test',
      kind: 'court',
      label: 'Cross-tenant probe',
    },
    removeIntakeAllowlistEntryAction: { workspaceId, entryId: t.a.rows.intake_allowlist?.id },
    enableEmailChannelAction: { workspaceId },
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
    // Automation feed (#49): ub, owner of B, may not page, preview, undo or reassign A's activity.
    loadMoreActivitiesAction: { workspaceId },
    previewActivityUndoAction: { workspaceId, activityId: randomUUID() },
    undoFeedActivityAction: { workspaceId, activityId: randomUUID() },
    undoCaptureAction: { workspaceId, captureId: randomUUID() },
    reassignFeedCaptureAction: { workspaceId, captureId: randomUUID(), matterId: aOtherMatterId },
    // A's pending support request (#313): ub, owner of B, may not grant, deny or end it.
    grantSupportSessionAction: { workspaceId, sessionId: aSupportSessionId },
    denySupportSessionAction: { workspaceId, sessionId: aSupportSessionId },
    revokeSupportSessionAction: { workspaceId, sessionId: aSupportSessionId },
    // Lifecycle (#305): ub, owner of B, may not export, delete or cancel A's deletion.
    requestExportAction: { workspaceId },
    listExportsAction: { workspaceId },
    listCourtWatchesAction: { workspaceId },
    addCourtWatchAction: { workspaceId, kind: 'brn', value: 'KAR/1/1900' },
    removeCourtWatchAction: { workspaceId, watchId: randomUUID() },
    // Case-status watches (#593): ub, owner of B, may not list, add, remove, refresh or record on A's.
    listCaseWatchesAction: { workspaceId },
    addCaseWatchAction: {
      workspaceId,
      proceedingId: randomUUID(),
      sourceId: 'in.tn.chennai-district:case_status',
      cnr: 'KABC010012342024',
    },
    removeCaseWatchAction: { workspaceId, watchId: randomUUID() },
    refreshCaseStatusAction: { workspaceId, watchId: randomUUID() },
    recordDeviceStatusAction: {
      workspaceId,
      watchId: randomUUID(),
      status: {
        template: 'ecourts-district',
        status: 'not_found',
        cnr: null,
        caseNumber: null,
        nextHearingDate: null,
        lastHearingDate: null,
        stage: null,
        bench: null,
        orders: [],
        quotes: {},
      },
    },
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
    // Portfolios (#666): A's portfolio id under B's workspace is not found; creation is B's own.
    createPortfolioAction: { workspaceId, name: 'Cross-tenant probe book' },
    importPortfolioAction: {
      workspaceId,
      portfolioId: t.a.rows.portfolio?.id,
      csv: 'cnr\nMHAU019999992026\n',
    },
    exportPortfolioCsvAction: { workspaceId, portfolioId: t.a.rows.portfolio?.id },
    // Capture inbox (#43): ub, owner of B, may not enable a channel on A, nor discard or pin A's capture.
    enableChannelAction: { workspaceId, channel: 'email', disclosureVersion: '2026-10-v1' },
    discardCaptureAction: { workspaceId, captureId: t.a.rows.capture?.id },
    pinCaptureAction: { workspaceId, captureId: t.a.rows.capture?.id, pinned: true },
    deleteRecordingAction: { workspaceId, captureId: t.a.rows.capture?.id },
    // Bootstrap import (#550): ub may not start a batch in A, nor add files to, build, apply, undo or read A's batch.
    startImportBatchAction: { workspaceId },
    addImportFilesAction: {
      workspaceId,
      batchId: t.a.rows.import_batch?.id,
      captureIds: [t.a.rows.capture?.id],
    },
    importProgressAction: { workspaceId, batchId: t.a.rows.import_batch?.id },
    // Zero-entry onboarding (#501): ub may not search into A's workspace, read A's batch progress or record a step there.
    discoverAdvocateCasesAction: {
      workspaceId,
      sourceIds: ['in.tn.madras-hc.chennai:advocate_search'],
      enrolmentNumbers: ['KAR/1/2020'],
      names: [],
      batchId: t.a.rows.import_batch?.id,
    },
    discoveryProgressAction: { workspaceId, batchId: t.a.rows.import_batch?.id },
    recordOnboardingStepAction: { workspaceId, step: 'confirm_grid_done' },
    getImportPlanAction: { workspaceId, batchId: t.a.rows.import_batch?.id },
    saveImportPlanEditsAction: {
      workspaceId,
      batchId: t.a.rows.import_batch?.id,
      groups: [{ tempId: 'm_a', title: 'Hijacked', proceedingKeys: ['k1'] }],
    },
    buildImportPlanAction: {
      workspaceId,
      batchId: t.a.rows.import_batch?.id,
      identifiers: { enrolmentNumbers: ['MS/9/1900'], aliases: [] },
      confirmIdentifiers: true,
    },
    applyImportPlanAction: { workspaceId, batchId: t.a.rows.import_batch?.id },
    undoImportBatchAction: { workspaceId, batchId: t.a.rows.import_batch?.id },
    // Calendar (#53): ub, owner of B, may not touch A's feed or review A's imported events.
    createCalendarFeedAction: {
      workspaceId,
      scope: 'mine',
      includeParties: false,
      disclosureVersion: '2026-10-v1',
    },
    rotateCalendarFeedAction: { workspaceId },
    revokeCalendarFeedAction: { workspaceId },
    setCalendarFeedPartiesAction: { workspaceId, includeParties: true },
    confirmCalendarEventAction: { workspaceId, captureId: t.a.rows.capture?.id, uid: 'xt-a' },
    skipCalendarEventAction: { workspaceId, captureId: t.a.rows.capture?.id, uid: 'xt-a' },
    noteCalendarEventAction: {
      workspaceId,
      captureId: t.a.rows.capture?.id,
      uid: 'xt-a',
      matterId: t.a.rows.matter?.matterId,
    },
    // Capture inbox decisions (#48): ub may not accept, edit, dismiss or undo A's proposals and
    // activities, move or keep or annotate A's captures, nor mark A's draft as sent.
    acceptProposalAction: { workspaceId, proposalId: t.a.rows.proposal?.proposalId },
    editAcceptProposalAction: {
      workspaceId,
      proposalId: t.a.rows.proposal?.proposalId,
      payload: { title: 'Cross-tenant probe' },
    },
    dismissProposalAction: { workspaceId, proposalId: t.a.rows.proposal?.proposalId },
    undoActivityAction: { workspaceId, activityId: t.a.rows.activity?.activityId },
    reassignCaptureAction: {
      workspaceId,
      captureId: t.a.rows.capture?.id,
      matterId: t.a.rows.matter?.matterId,
    },
    keepAsAttachmentAction: { workspaceId, captureId: t.a.rows.capture?.id },
    typeKeyLineAction: { workspaceId, captureId: t.a.rows.capture?.id, text: 'Probe line' },
    markSentAction: { workspaceId, providerId: 'xt-probe', itemId: 'xt-probe' },
    // Stale-matter attention (#70): ub may not list, snooze, dismiss or lift on A's matters.
    listAttentionAction: { workspaceId },
    snoozeFlagAction: {
      workspaceId,
      matterId: t.a.rows.attention_snooze?.matterId ?? XT_ID,
      rule: null,
      until: '2099-01-01',
      reason: 'Cross-tenant probe',
    },
    dismissFlagAction: {
      workspaceId,
      matterId: t.a.rows.attention_snooze?.matterId ?? XT_ID,
      rule: null,
    },
    liftSnoozeAction: { workspaceId, snoozeId: t.a.rows.attention_snooze?.snoozeId ?? XT_ID },
    // Obligation queue (#68): ub may not close, reschedule, reassign or add to A's obligations.
    closeObligationAction: {
      workspaceId,
      obligationId: t.a.rows.obligation?.id ?? XT_ID,
      reason: 'task_completed',
    },
    rescheduleAction: {
      workspaceId,
      obligationId: t.a.rows.obligation?.id ?? XT_ID,
      dueDate: '2030-01-01',
      reason: 'Cross-tenant probe',
    },
    reassignAction: {
      workspaceId,
      obligationId: t.a.rows.obligation?.id ?? XT_ID,
      ownerMemberId: XT_ID,
    },
    addObligationAction: {
      workspaceId,
      matterId: t.a.rows.matter?.matterId ?? XT_ID,
      description: 'Cross-tenant probe',
      dueDate: null,
      ownerMemberId: XT_ID,
    },
    // Memory (#73): ub may not confirm, edit, delete, pause or read the usage of A's memory.
    confirmAction: { workspaceId, proposalId: XT_ID },
    dismissAction: { workspaceId, proposalId: XT_ID },
    editAction: { workspaceId, itemId: XT_ID, value: 'Cross-tenant probe' },
    deleteAction: { workspaceId, itemId: XT_ID },
    pauseAction: { workspaceId, itemId: XT_ID, paused: true },
    pauseAllAction: { workspaceId, paused: true },
    addNoteAction: { workspaceId, key: 'M4.hall_note', value: 'Cross-tenant probe' },
    usageAction: { workspaceId, itemId: XT_ID },
    completeReviewAction: { workspaceId },
    // Playbooks and precedents (#903): ub may not confirm, dismiss, propose, retire or delete A's.
    confirmPrecedentAction: { workspaceId, proposalId: XT_ID },
    dismissPrecedentAction: { workspaceId, proposalId: XT_ID, reason: 'not_reusable' },
    proposePlaybookAction: {
      workspaceId,
      playbook: {
        name: 'Cross-tenant probe',
        courtId: null,
        format: 'writ_petition',
        standardPrayers: [],
        annexureOrder: [],
      },
    },
    confirmPlaybookAction: { workspaceId, proposalId: XT_ID },
    deletePlaybookAction: { workspaceId, itemId: XT_ID },
    retirePrecedentAction: { workspaceId, itemId: XT_ID },
    deletePrecedentAction: { workspaceId, itemId: XT_ID },
    // Outward drafts (#736): ub may not draft on A's matter, nor edit or mark shared A's draft.
    composeDraftAction: {
      workspaceId,
      matterId: t.a.rows.matter?.matterId ?? XT_ID,
      audience: 'client',
    },
    saveDraftEditAction: {
      workspaceId,
      draftId: t.a.rows.outward_draft?.id ?? XT_ID,
      body: 'Cross-tenant probe',
    },
    markDraftSharedAction: {
      workspaceId,
      draftId: t.a.rows.outward_draft?.id ?? XT_ID,
      channel: 'clipboard',
    },
    useNextStepAction: {
      workspaceId,
      type: 'task',
      text: 'Cross-tenant probe',
      matterId: t.a.rows.matter?.matterId ?? XT_ID,
      dueDate: null,
      ownerMemberId: XT_ID,
    },
    // Delegation (#63): ub, owner of B, may not assign appearances in A.
    assignAppearanceAction: {
      workspaceId,
      listingId: t.a.rows.listing?.listingId,
      memberId: t.a.rows.listing?.listingId,
      capacity: 'arguing',
    },
    acceptSuggestionAction: {
      workspaceId,
      suggestion: {
        listingId: t.a.rows.listing?.listingId,
        memberId: t.a.rows.listing?.listingId,
        capacity: 'arguing',
      },
    },
    acceptAllSuggestionsAction: {
      workspaceId,
      suggestions: [
        {
          listingId: t.a.rows.listing?.listingId,
          memberId: t.a.rows.listing?.listingId,
          capacity: 'arguing',
        },
      ],
    },
    outcomesLiveAction: { workspaceId, date: '2026-10-26' },
    // Brief sharing (#507): ub, owner of B, may not share A's brief or revoke A's link.
    createBriefShareAction: {
      workspaceId,
      listingId: t.a.rows.listing?.listingId,
      expiresInDays: 7,
    },
    revokeBriefShareAction: { workspaceId, shareId: crypto.randomUUID() },
    // Matters (#388): ub, owner of B, may not add a matter to A or search A's matters.
    createMatterAction: { workspaceId, title: 'Cross-tenant probe matter' },
    // Drafts (#826): ub may not create a draft in A, even from a real-looking template id.
    createDraftAction: {
      workspaceId,
      templateId: '00000000-0000-4000-8000-0000000000d1',
      matterId: null,
      title: 'Cross-tenant probe draft',
    },
    searchMattersAction: { workspaceId, q: 'XT Matter' },
    checkConflictsAction: {
      workspaceId,
      parties: [{ name: 'Cross-tenant probe party', side: 'adverse' }],
    },
    // Matter workspace (#390): ub may not change A's matter or resolve A's next dates.
    updateMatterAction: {
      workspaceId,
      matterId: t.a.rows.matter?.matterId,
      patch: { synopsis: 'Cross-tenant probe synopsis' },
    },
    setSensitiveAction: { workspaceId, matterId: t.a.rows.matter?.matterId, sensitive: true },
    confirmNextDateAction: { workspaceId, listingId: t.a.rows.listing?.listingId },
    // Drafting studio (#827): ub may not save to or restore a version of A's draft.
    saveDraftAction: {
      workspaceId,
      draftId: t.a.rows.draft_version?.draftId,
      baseVersionNo: 1,
      blocks: [{ type: 'paragraph', text: 'Cross-tenant probe' }],
    },
    restoreDraftVersionAction: {
      workspaceId,
      draftId: t.a.rows.draft_version?.draftId,
      versionNo: 1,
    },
    // Drafting precedents (#904): ub's search sees none of A's passages; ub may not propose from A's version.
    searchPrecedentsForBlockAction: {
      workspaceId,
      query: 'prayer for interim relief',
      courtId: null,
      kind: null,
      language: 'en',
    },
    proposePrecedentAction: {
      workspaceId,
      passageText: 'Cross-tenant probe',
      kind: 'other',
      courtId: null,
      language: 'en',
      draftVersionId: t.a.rows.draft_version?.id,
      anchorId: 'b.0',
    },
    // Drafting checks (#828): ub may not check, acknowledge, fix or export A's draft.
    runChecksAction: { workspaceId, draftVersionId: t.a.rows.draft_version?.id },
    acknowledgeUnverifiedAction: {
      workspaceId,
      draftVersionId: t.a.rows.draft_version?.id,
      citationIds: [randomUUID()],
      reason: 'Cross-tenant probe',
    },
    applyFixAction: {
      workspaceId,
      draftVersionId: t.a.rows.draft_version?.id,
      findingId: 'probe',
      confirm: true,
    },
    exportDraftAction: { workspaceId, draftId: t.a.rows.draft_version?.draftId, format: 'docx' },
    // Fact-check (#914): ub may not check, ignore, assert, acknowledge or log a fix on A's draft.
    runFactCheckAction: { workspaceId, draftVersionId: t.a.rows.draft_version?.id },
    checkFactsLiveAction: {
      workspaceId,
      matterId: t.a.rows.matter?.matterId,
      blocks: [{ key: 'b.0', text: 'Order dated 01/02/2024.' }],
    },
    ignoreFactAction: {
      workspaceId,
      draftVersionId: t.a.rows.draft_version?.id,
      claimKey: 'date:2024-01-01',
    },
    markAssertionAction: {
      workspaceId,
      draftVersionId: t.a.rows.draft_version?.id,
      claimKey: 'date:2024-01-01',
    },
    acknowledgeFactCheckAction: {
      workspaceId,
      draftVersionId: t.a.rows.draft_version?.id,
      reason: 'Cross-tenant probe',
      confirm: true,
    },
    recordFactFixAction: {
      workspaceId,
      fromVersionId: t.a.rows.draft_version?.id,
      toVersionId: t.a.rows.draft_version?.id,
    },
    downloadDraftExportAction: { workspaceId, exportId: randomUUID() },
    // Hearing outcome (#62): ub may not confirm A's hearing outcome.
    confirmOutcomeAction: {
      workspaceId,
      hearingId: t.a.rows.hearing?.hearingId,
      outcome: 'Cross-tenant probe outcome',
      nextDate: { kind: 'none' },
    },
    recordManualOutcomeAction: {
      workspaceId,
      hearingId: t.a.rows.hearing?.hearingId,
      outcome: 'Cross-tenant probe outcome',
      nextDate: { kind: 'none' },
    },
    // Continuity (#71): ub may not read, save, acknowledge or record views on A's matter or handover.
    generateHandoverAction: { workspaceId, matterId: t.a.rows.handover_note?.matterId },
    saveHandoverAction: {
      workspaceId,
      matterId: t.a.rows.handover_note?.matterId,
      recipientMemberId: t.a.rows.handover_note?.matterId,
    },
    listHandoversAction: { workspaceId, matterId: t.a.rows.handover_note?.matterId },
    acknowledgeHandoverAction: { workspaceId, handoverId: t.a.rows.handover_note?.id },
    recordViewAction: { workspaceId, matterId: t.a.rows.handover_note?.matterId },
    whatChangedAction: {
      workspaceId,
      matterId: t.a.rows.handover_note?.matterId,
      since: '2026-01-01T00:00:00.000Z',
    },
    // Brief sheet (#61): ub may not mark, tick or note A's listing.
    markPreparedAction: { workspaceId, listingId: t.a.rows.listing?.listingId, prepared: true },
    setCarryItemAction: {
      workspaceId,
      listingId: t.a.rows.listing?.listingId,
      action: 'add',
      label: 'Cross-tenant probe',
    },
    setBriefNoteAction: {
      workspaceId,
      listingId: t.a.rows.listing?.listingId,
      note: 'Cross-tenant probe note',
    },
    setPrintNotesAction: { workspaceId, include: true },
    // Research tab (#497): ub may not tag A's matter or confirm A's tag.
    addTagAction: { workspaceId, matterId: t.a.rows.matter_issue_tag?.matterId, statute: 'ipc' },
    confirmTagAction: {
      workspaceId,
      matterId: t.a.rows.matter_issue_tag?.matterId,
      tagId: t.a.rows.matter_issue_tag?.id,
    },
    dismissTagAction: {
      workspaceId,
      matterId: t.a.rows.matter_issue_tag?.matterId,
      tagId: t.a.rows.matter_issue_tag?.id,
    },
    // Research notes and provider templates (#80): ub may not write A's notes or A's templates.
    createNoteAction: { workspaceId, matterId: t.a.rows.research_note?.matterId, title: 'x' },
    updateNoteAction: {
      workspaceId,
      matterId: t.a.rows.research_note?.matterId,
      noteId: t.a.rows.research_note?.id,
      title: 'x',
      body: 'x',
    },
    deleteNoteAction: {
      workspaceId,
      matterId: t.a.rows.research_note?.matterId,
      noteId: t.a.rows.research_note?.id,
    },
    addAuthorityAction: {
      workspaceId,
      matterId: t.a.rows.research_note?.matterId,
      noteId: t.a.rows.research_note?.id,
      label: 'x',
    },
    removeAuthorityAction: {
      workspaceId,
      matterId: t.a.rows.research_note?.matterId,
      noteId: t.a.rows.research_note?.id,
      index: 0,
    },
    setAuthorityPinnedAction: {
      workspaceId,
      matterId: t.a.rows.research_note?.matterId,
      noteId: t.a.rows.research_note?.id,
      index: 0,
      pinned: true,
    },
    saveProviderTemplateAction: {
      workspaceId,
      key: 'xt-provider',
      label: 'B',
      urlTemplate: 'https://b.example.test/?q={q}',
    },
    removeProviderTemplateAction: { workspaceId, key: 'xt-provider' },
    chooseNextDateSourceAction: {
      workspaceId,
      currentListingId: t.a.rows.listing?.listingId,
      proposedListingId: t.a.rows.listing?.listingId,
      choice: 'current',
    },
    reportRecordErrorAction: {
      workspaceId,
      proceedingId: t.a.rows.proceeding?.proceedingId,
      field: 'next_date',
      shownValue: '1 Jan 2026',
      reportedValue: '2 Jan 2026',
      consent: true,
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
    // People screens (#848): A's client and contact
    createContactAction: {
      workspaceId,
      personId: t.a.rows.client_contact?.personId,
      phone: '+919876543299',
    },
    updateContactAction: {
      workspaceId,
      contactId: t.a.rows.client_contact?.id,
      phone: '+919876543298',
    },
    undoContactChangeAction: { workspaceId, activityId: randomUUID() },
    linkContactToMatterAction: {
      workspaceId,
      contactId: t.a.rows.client_contact?.id,
      matterId: t.a.rows.matter?.matterId,
    },
    archiveContactAction: { workspaceId, contactId: t.a.rows.client_contact?.id },
    // Enquiry log (#874): ub may not log into, change, check, accept or close A's enquiries.
    logEnquiryAction: { workspaceId, enquirerName: 'Probe', summary: 'Probe', parties: [] },
    updateEnquiryAction: { workspaceId, enquiryId: t.a.rows.enquiry?.id, summary: 'Changed' },
    runConflictCheckAction: { workspaceId, enquiryId: t.a.rows.enquiry?.id },
    acceptEnquiryAction: { workspaceId, enquiryId: t.a.rows.enquiry?.id },
    closeEnquiryAction: { workspaceId, enquiryId: t.a.rows.enquiry?.id },
    // Limitation tracker (#941): ub may not compute against A's matter or confirm A's computation.
    computeLimitationAction: {
      workspaceId,
      matterId: t.a.rows.limitation_computation?.matterId,
      ruleCode: 'xt.probe',
      startDate: '2026-04-01',
    },
    confirmLimitationAction: { workspaceId, computationId: t.a.rows.limitation_computation?.id },
    // Fees and invoices (#871): ub may not agree fees on, or invoice, A's matter and client, nor
    // activate, change, discard or issue A's agreement and invoice.
    createFeeAgreementAction: {
      workspaceId,
      agreement: {
        matterId: t.a.rows.fee_agreement?.matterId,
        personId: t.a.rows.fee_agreement?.personId,
        basis: 'fixed',
        amountPaise: 100,
        gstTreatment: 'forward_charge',
        startsOn: '2026-04-01',
      },
    },
    setFeeAgreementStatusAction: {
      workspaceId,
      agreementId: t.a.rows.fee_agreement?.id,
      status: 'active',
    },
    previewInvoiceAction: feeInvoiceProbe(workspaceId),
    saveInvoiceDraftAction: feeInvoiceProbe(workspaceId),
    discardInvoiceDraftAction: { workspaceId, invoiceId: t.a.rows.fee_invoice?.invoiceId },
    issueInvoiceAction: {
      workspaceId,
      invoiceId: t.a.rows.fee_invoice?.invoiceId,
      supplier: { name: 'Probe', stateCode: '29' },
    },
    // Proceedings tab (#392): ub may not add to, change, link, move, merge or split A's matters and
    // proceedings, nor undo a merge or split naming them.
    ...proceedingsInputs(workspaceId),
  };
}

/** A draft invoice for A's matter and client, as `previewInvoiceAction` and `saveInvoiceDraftAction` take it. */
function feeInvoiceProbe(workspaceId: string) {
  return {
    workspaceId,
    invoice: {
      matterId: t.a.rows.fee_invoice?.matterId,
      personId: t.a.rows.fee_invoice?.personId,
      placeOfSupplyStateCode: '29',
      lines: [
        {
          description: 'Probe',
          quantity: 1,
          unitPricePaise: 100,
          amountPaise: 100,
          gstTreatment: 'forward_charge',
        },
      ],
    },
    supplier: { name: 'Probe', stateCode: '29' },
  };
}

/** A fixed `updated_at` for the probe undo payloads. */
const AT = '2026-01-01 00:00:00+00';

function proceedingsInputs(workspaceId: string): Record<string, unknown> {
  const aMatter = t.a.rows.matter?.matterId;
  const aProceeding = t.a.rows.proceeding?.proceedingId ?? '';
  const link = t.a.rows.proceeding_link;
  return {
    createProceedingAction: {
      workspaceId,
      matterId: aMatter,
      forumId: t.a.rows.forum?.forumId,
      caseType: 'W.P.',
      number: '4242',
      year: 2026,
    },
    updateProceedingAction: { workspaceId, proceedingId: aProceeding, number: '4343' },
    transitionProceedingAction: { workspaceId, proceedingId: aProceeding, to: 'sr_fr' },
    linkProceedingsAction: {
      workspaceId,
      fromProceedingId: aProceeding,
      toProceedingId: link?.childId ?? aProceeding,
      kind: 'connected',
    },
    findDuplicateProceedingsAction: {
      workspaceId,
      matterId: aMatter,
      identity: { caseType: 'XT', number: '1', year: 2026 },
    },
    previewMergeAction: { workspaceId, intoMatterId: aMatter, fromMatterId: aOtherMatterId },
    previewSplitAction: { workspaceId, matterId: aOtherMatterId, proceedingIds: [aProceeding] },
    mergeMattersAction: { workspaceId, intoMatterId: aMatter, fromMatterId: aOtherMatterId },
    undoMergeAction: {
      workspaceId,
      payload: {
        op: 'matter.merge',
        version: 1,
        before: {
          intoMatterId: aMatter,
          fromMatterId: aOtherMatterId,
          fromMatter: { mergedIntoMatterId: null, updatedAt: AT },
          rows: {
            proceeding: [{ id: aProceeding, updatedAt: AT }],
            document: [],
            roleEdge: [],
            obligation: [],
            task: [],
            mergedMatter: [],
          },
          links: [],
        },
        after: { intoMatterId: aMatter },
      },
    },
    splitMatterAction: {
      workspaceId,
      slug: workspaceId === t.b.id ? t.b.slug : t.a.slug,
      matterId: aOtherMatterId,
      proceedingIds: [aProceeding],
      newTitle: 'Cross-tenant probe split',
    },
    undoSplitAction: {
      workspaceId,
      payload: {
        op: 'matter.split',
        version: 1,
        before: {
          matterId: aOtherMatterId,
          rows: { proceeding: [{ id: aProceeding, updatedAt: AT }], obligation: [], task: [] },
        },
        after: { newMatterId: aMatter },
      },
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

  it('offline push under B’s own workspace refuses A’s ids per item and writes nothing (#743)', async () => {
    const before = await snapshotA();
    const all = inputs(t.b.id);
    const pushed = (await action('pushOutboxAction')(all.pushOutboxAction)) as {
      ok: boolean;
      data?: { status: string }[];
    };
    expect(pushed.ok).toBe(true);
    expect(pushed.data?.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    const pulled = (await action('pullCourtDaySnapshotAction')(all.pullCourtDaySnapshotAction)) as {
      ok: boolean;
      data?: { briefs: unknown[] };
    };
    expect(pulled.ok).toBe(true);
    expect(pulled.data?.briefs).toEqual([]);
    expect(await snapshotA()).toEqual(before);
  });

  it('offline push replayed adds one proposal and the same keys answer duplicate (#743)', async () => {
    signInAs(t.ua);
    const proceedingId = t.a.rows.proceeding?.proceedingId;
    const current = await withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
      tx
        .select({
          listDate: schema.listing.listDate,
          proceedingId: schema.listing.proceedingId,
          canonical: schema.listing.canonical,
        })
        .from(schema.listing),
    );
    const canonical = current.find((r) => r.proceedingId === proceedingId && r.canonical);
    const item = {
      key: 'xt-replay',
      kind: 'next_date',
      proceedingId,
      date: '2031-06-06',
      expectedCanonicalDate: canonical?.listDate ?? null,
    };
    const count = () =>
      withWorkspace(testAppDb(), { workspaceId: t.a.id }, async (tx) => {
        const rows = await tx.select({ date: schema.listing.listDate }).from(schema.listing);
        return rows.filter((r) => r.date === '2031-06-06').length;
      });
    const push = async (items: unknown[]) =>
      (await action('pushOutboxAction')({ workspaceId: t.a.id, items })) as {
        ok: boolean;
        data?: { status: string }[];
      };
    expect((await push([item, item])).data?.map((r) => r.status)).toEqual(['applied', 'duplicate']);
    expect(await count()).toBe(1);
    // A later batch with the same key finds the earlier proposal: no second row.
    expect((await push([item])).data?.[0]?.status).toBe('applied');
    expect(await count()).toBe(1);
  });

  it('court-day marker actions refuse a hall outside the workspace and write nothing', async () => {
    const before = await snapshotA();
    for (const workspaceId of [t.a.id, t.b.id]) {
      const all = inputs(workspaceId);
      const set = (await action('setCurrentItemAction')(all.setCurrentItemAction)) as {
        ok: boolean;
      };
      expect(set.ok, `set ${workspaceId}`).toBe(false);
      // Clearing a marker that does not exist is a no-op, never an error and never a write.
      await action('clearCurrentItemAction')(all.clearCurrentItemAction);
    }
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

  it('reminder preferences under B’s own workspace change only ub’s rows in B (#64)', async () => {
    const before = await snapshotA();
    const all = inputs(t.b.id);
    expect(
      await action('setReminderPreferencesAction')(all.setReminderPreferencesAction),
    ).toMatchObject({ ok: true, data: { evening: { time: '21:00', channels: { push: false } } } });
    expect(
      await action('getReminderPreferencesAction')(all.getReminderPreferencesAction),
    ).toMatchObject({ ok: true, data: { outcome_missing: { delayMinutes: 60 } } });
    expect(await snapshotA()).toEqual(before);
  });

  it('WhatsApp link actions under B’s own workspace touch only ub’s rows in B (#681)', async () => {
    const before = await snapshotA();
    const all = inputs(t.b.id);
    // Unlink first: earlier probes may have left a pending code, and a new request waits a minute.
    expect(await action('unlinkWhatsAppAction')(all.unlinkWhatsAppAction)).toMatchObject({
      ok: true,
    });
    expect(await action('requestWhatsAppOtpAction')(all.requestWhatsAppOtpAction)).toMatchObject({
      ok: true,
    });
    expect(await action('getWhatsAppLinkAction')(all.getWhatsAppLinkAction)).toMatchObject({
      ok: true,
      data: null,
    });
    // A wrong guess is refused, not linked.
    expect(await action('verifyWhatsAppOtpAction')(all.verifyWhatsAppOtpAction)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(
      await action('setWhatsAppCategoriesAction')(all.setWhatsAppCategoriesAction),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(await snapshotA()).toEqual(before);
  });

  it('saveNewsPreferencesAction under B’s own workspace saves only ub’s row in B (#481)', async () => {
    const before = await snapshotA();
    const input = inputs(t.b.id).saveNewsPreferencesAction;
    expect(await action('saveNewsPreferencesAction')(input)).toMatchObject({
      ok: true,
      data: { practiceAreas: ['tax'], digestTime: '08:00' },
    });
    expect(await snapshotA()).toEqual(before);
    const inB = await withWorkspace(testAppDb(), { workspaceId: t.b.id }, (tx) =>
      tx.select().from(schema.newsPref),
    );
    expect(inB.filter((row) => row.userId === t.ub && row.workspaceId === t.b.id)).toHaveLength(1);
    expect(inB.every((row) => row.workspaceId === t.b.id)).toBe(true);
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

  it('saveSsoProviderAction and deleteSsoProviderAction under B’s own workspace change only B', async () => {
    const before = await snapshotA();
    const saved = await action('saveSsoProviderAction')(inputs(t.b.id).saveSsoProviderAction);
    expect(saved).toMatchObject({
      ok: true,
      data: { protocol: 'oidc', enabled: false, domainVerified: false },
    });
    // The result never carries the provider's settings.
    expect(JSON.stringify(saved)).not.toContain('probe-secret');
    expect(await snapshotA()).toEqual(before);
    const { id } = (saved as { data: { id: string } }).data;
    expect(
      await action('deleteSsoProviderAction')({ workspaceId: t.b.id, providerId: id }),
    ).toEqual({
      ok: true,
      data: { id },
    });
    expect(await snapshotA()).toEqual(before);
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

  it('the email intake actions under B’s own workspace change only B (#54)', async () => {
    const before = await snapshotA();
    const own = inputs(t.b.id);
    // B's owner already holds the seeded active address: retire it, then create a fresh one.
    expect(
      await action('revokeIntakeAddressAction')({
        workspaceId: t.b.id,
        addressId: t.b.rows.intake_address?.id,
      }),
    ).toMatchObject({ ok: true });
    const created = (await action('createIntakeAddressAction')(own.createIntakeAddressAction)) as {
      ok: boolean;
      data: { id: string; address: string };
    };
    expect(created.ok).toBe(true);
    expect(created.data.address).toMatch(/^u-[a-z2-7]{10}@localhost$/);
    const rotated = (await action('rotateIntakeAddressAction')(own.rotateIntakeAddressAction)) as {
      ok: boolean;
      data: { id: string; address: string };
    };
    expect(rotated.ok).toBe(true);
    expect(rotated.data.address).not.toBe(created.data.address);
    const entry = (await action('addIntakeAllowlistEntryAction')(
      own.addIntakeAllowlistEntryAction,
    )) as { ok: boolean; data: { id: string } };
    expect(entry.ok).toBe(true);
    expect(
      await action('removeIntakeAllowlistEntryAction')({
        workspaceId: t.b.id,
        entryId: entry.data.id,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await action('revokeIntakeAddressAction')({
        workspaceId: t.b.id,
        addressId: rotated.data.id,
      }),
    ).toMatchObject({ ok: true });
    expect(await action('enableEmailChannelAction')(own.enableEmailChannelAction)).toMatchObject({
      ok: true,
      data: { enabled: true },
    });
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
    // The conflict check (#500) under B's own workspace finds none of A's parties.
    const checked = (await action('checkConflictsAction')(own.checkConflictsAction)) as {
      ok: boolean;
      data: unknown[];
    };
    expect(checked).toEqual({ ok: true, data: [] });
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
      'reportRecordErrorAction',
      'addTagAction',
      'confirmTagAction',
      'dismissTagAction',
      'createNoteAction',
      'updateNoteAction',
      'deleteNoteAction',
      'addAuthorityAction',
      'removeAuthorityAction',
      'setAuthorityPinnedAction',
      // People tab (#393): A's matter and person
      'upsertPersonAction',
      'setRoleEdgeAction',
      // People screens (#848): A's contact, client and matter
      'createContactAction',
      'updateContactAction',
      'linkContactToMatterAction',
      'archiveContactAction',
      // Enquiry log (#874): A's enquiry
      'updateEnquiryAction',
      'runConflictCheckAction',
      'acceptEnquiryAction',
      'closeEnquiryAction',
      // Limitation tracker (#941): A's matter and computation
      'computeLimitationAction',
      'confirmLimitationAction',
      // Fees and invoices (#871): A's agreement, invoice, matter and client
      'createFeeAgreementAction',
      'setFeeAgreementStatusAction',
      'saveInvoiceDraftAction',
      'discardInvoiceDraftAction',
      'issueInvoiceAction',
    ]) {
      const result = await action(name)(own[name]);
      expect(['NOT_FOUND', 'FORBIDDEN'], name).toContain(code(result));
      expect(result, name).not.toHaveProperty('data');
    }
    expect(await snapshotA()).toEqual(before);
  });

  it('drafting studio actions under B’s own workspace find none of A’s draft (#827)', async () => {
    const own = inputs(t.b.id);
    const versions = () =>
      withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
        tx.select({ id: schema.draftVersion.id }).from(schema.draftVersion),
      );
    const before = await versions();
    for (const name of ['saveDraftAction', 'restoreDraftVersionAction']) {
      const result = await action(name)(own[name]);
      expect(['NOT_FOUND', 'FORBIDDEN'], name).toContain(code(result));
      expect(result, name).not.toHaveProperty('data');
    }
    expect(await versions()).toEqual(before);
  });

  it('drafting checks actions under B’s own workspace find none of A’s draft (#828)', async () => {
    const own = inputs(t.b.id);
    for (const name of [
      'runChecksAction',
      'acknowledgeUnverifiedAction',
      'applyFixAction',
      'exportDraftAction',
      'downloadDraftExportAction',
      'runFactCheckAction',
      'checkFactsLiveAction',
      'ignoreFactAction',
      'markAssertionAction',
      'acknowledgeFactCheckAction',
      'recordFactFixAction',
    ]) {
      const result = await action(name)(own[name]);
      expect(['NOT_FOUND', 'FORBIDDEN'], name).toContain(code(result));
      expect(result, name).not.toHaveProperty('data');
    }
  });

  it('precedent actions under B’s own workspace find none of A’s passages or draft (#904)', async () => {
    const own = inputs(t.b.id);
    const searched = await action('searchPrecedentsForBlockAction')(
      own['searchPrecedentsForBlockAction'],
    );
    // The seeded workspace keys are random bytes, so the memory crypto may refuse; what must hold is
    // that B never receives a passage.
    if ((searched as { ok: boolean }).ok) expect(searched).toHaveProperty('data.passages', []);
    else expect(searched).not.toHaveProperty('data');
    const proposed = await action('proposePrecedentAction')(own['proposePrecedentAction']);
    expect(['NOT_FOUND', 'FORBIDDEN']).toContain(code(proposed));
    expect(proposed).not.toHaveProperty('data');
  });

  it('hearing outcome actions under B’s own workspace find none of A’s hearing (#62)', async () => {
    const before = await snapshotA();
    const own = inputs(t.b.id);
    for (const name of ['confirmOutcomeAction', 'recordManualOutcomeAction']) {
      const result = await action(name)(own[name]);
      expect(['NOT_FOUND', 'FORBIDDEN'], name).toContain(code(result));
      expect(result, name).not.toHaveProperty('data');
    }
    expect(await snapshotA()).toEqual(before);
  });

  it('brief sheet actions under B’s own workspace find none of A’s listing (#61)', async () => {
    const before = await snapshotA();
    const own = inputs(t.b.id);
    for (const name of ['markPreparedAction', 'setCarryItemAction', 'setBriefNoteAction']) {
      const result = await action(name)(own[name]);
      expect(['NOT_FOUND', 'FORBIDDEN'], name).toContain(code(result));
      expect(result, name).not.toHaveProperty('data');
    }
    expect(await snapshotA()).toEqual(before);
  });

  it('proceedings tab actions under B’s own workspace find none of A’s matter or proceedings (#392)', async () => {
    const before = await snapshotA();
    const own = inputs(t.b.id);
    for (const name of [
      'createProceedingAction',
      'updateProceedingAction',
      'transitionProceedingAction',
      'linkProceedingsAction',
      'previewMergeAction',
      'previewSplitAction',
      'mergeMattersAction',
      'undoMergeAction',
      'splitMatterAction',
      'undoSplitAction',
    ]) {
      const result = await action(name)(own[name]);
      expect(['NOT_FOUND', 'FORBIDDEN'], name).toContain(code(result));
      expect(result, name).not.toHaveProperty('data');
    }
    // The duplicate finder is scoped: under B it sees none of A's proceedings.
    const aIds = new Set(before.proceedings.map((row) => row.id));
    const aProceeding = before.proceedings.find(
      (row) => row.id === t.a.rows.proceeding?.proceedingId,
    );
    for (const identity of [
      { caseType: 'XT', number: '1', year: 2026 },
      ...(aProceeding?.number && aProceeding.year
        ? [{ caseType: 'WP', number: aProceeding.number, year: aProceeding.year }]
        : []),
    ]) {
      const found = (await action('findDuplicateProceedingsAction')({
        ...(own.findDuplicateProceedingsAction as object),
        identity,
      })) as { ok: boolean; data: { id: string }[] };
      expect(found.ok).toBe(true);
      expect(found.data.filter((hit) => aIds.has(hit.id))).toEqual([]);
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

  it('portfolio actions under B’s own workspace find none of A’s portfolio (#666)', async () => {
    const before = await snapshotA();
    const aPortfolios = () =>
      withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
        tx.select().from(schema.portfolio).orderBy(schema.portfolio.id),
      );
    const portfoliosBefore = await aPortfolios();
    const own = inputs(t.b.id);
    for (const name of ['importPortfolioAction', 'exportPortfolioCsvAction'] as const) {
      expect(await action(name)(own[name]), name).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    expect(await action('createPortfolioAction')(own.createPortfolioAction)).toMatchObject({
      ok: true,
    });
    expect(await aPortfolios()).toEqual(portfoliosBefore);
    expect(await snapshotA()).toEqual(before);
  });

  it('capture actions under B’s own workspace find none of A’s captures and change only B (#43)', async () => {
    const before = await snapshotA();
    const aCaptures = () =>
      withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
        tx.select().from(schema.capture).orderBy(schema.capture.id),
      );
    const capturesBefore = await aCaptures();
    expect(capturesBefore.length).toBeGreaterThan(0);
    const own = inputs(t.b.id);
    for (const name of [
      'discardCaptureAction',
      'pinCaptureAction',
      'deleteRecordingAction',
    ] as const) {
      // A's capture id under B's workspace: not found, whatever B's role.
      expect(await action(name)(own[name]), name).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    expect(await action('enableChannelAction')(own.enableChannelAction)).toMatchObject({
      ok: true,
      data: { channel: 'email', enabled: true },
    });
    const channelsOfA = await withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
      tx.select().from(schema.workspaceCaptureChannel),
    );
    // Only A's own seeded row; B's enable never reached A.
    expect(channelsOfA).toHaveLength(1);
    expect(await snapshotA()).toEqual(before);
    expect(await aCaptures()).toEqual(capturesBefore);
  });

  it('calendar actions under B’s own workspace create B’s feed only and find none of A’s events (#53)', async () => {
    const feedsOfA = () =>
      withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
        tx.select().from(schema.icsFeed).orderBy(schema.icsFeed.id),
      );
    const before = await snapshotA();
    const feedsBefore = await feedsOfA();
    const own = inputs(t.b.id);
    const created = (await action('createCalendarFeedAction')(own.createCalendarFeedAction)) as {
      ok: boolean;
      data: { url: string };
    };
    expect(created.ok).toBe(true);
    expect(created.data.url).toMatch(/^http:\/\/localhost:3000\/api\/ics\/[\w-]{43}$/);
    for (const name of [
      'confirmCalendarEventAction',
      'skipCalendarEventAction',
      'noteCalendarEventAction',
    ] as const) {
      // A's capture and event under B's workspace: not found, whatever B's role.
      expect(await action(name)(own[name]), name).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    const feedsOfB = await withWorkspace(testAppDb(), { workspaceId: t.b.id }, (tx) =>
      tx.select().from(schema.icsFeed),
    );
    expect(feedsOfB.filter((feed) => feed.revokedAt === null)).toHaveLength(1);
    expect(await feedsOfA()).toEqual(feedsBefore);
    expect(await snapshotA()).toEqual(before);
  });

  it('acceptInvitationAction with A’s token does not let ub into A', async () => {
    const before = await snapshotA();
    const result = await action('acceptInvitationAction')({ token: aInvitation.token });
    expect(result).toEqual({ ok: true, data: { status: 'rejected', reason: 'EMAIL_MISMATCH' } });
    expect(await snapshotA()).toEqual(before);
  });

  it('importSharedBriefAction with a token that names no share imports nothing and leaves A alone', async () => {
    const before = await snapshotA();
    const result = await action('importSharedBriefAction')({ token: 'not-a-real-token-at-all' });
    expect(result).toEqual({ ok: true, data: { status: 'rejected', reason: 'INVALID' } });
    expect(await snapshotA()).toEqual(before);
  });

  it('brief share actions under B’s workspace cannot share A’s listing or revoke A’s link (#507)', async () => {
    const aShare = await withWorkspace(testAppDb(), { workspaceId: t.a.id }, async (tx) => {
      const [row] = await tx
        .insert(schema.briefShare)
        .values({
          workspaceId: t.a.id,
          tokenHash: `xt-${crypto.randomUUID()}`,
          snapshot: {
            matterTitle: 'XT',
            synopsis: null,
            stage: null,
            lastOrder: [],
            lastHearing: null,
            openObligations: [],
            assembledAt: new Date().toISOString(),
          },
          createdBy: t.ua,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning({ id: schema.briefShare.id });
      if (row === undefined) throw new Error('seed share');
      return row.id;
    });
    const sharesOfA = () =>
      withWorkspace(testAppDb(), { workspaceId: t.a.id }, (tx) =>
        tx.select().from(schema.briefShare),
      );
    const before = await sharesOfA();
    const created = await action('createBriefShareAction')({
      workspaceId: t.b.id,
      listingId: t.a.rows.listing?.listingId,
      expiresInDays: 7,
    });
    expect(code(created)).toBe('NOT_FOUND');
    const revoked = await action('revokeBriefShareAction')({
      workspaceId: t.b.id,
      shareId: aShare,
    });
    expect(code(revoked)).toBe('NOT_FOUND');
    const after = await sharesOfA();
    expect(after).toEqual(before);
    expect(after.find((row) => row.id === aShare)?.revokedAt).toBeNull();
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
