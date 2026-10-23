// Admin and support activity is audited with actor kind `staff` (#310, part of #27):
//   * every `'use server'` export under apps/admin/app is listed in ACTIONS below (a new action fails
//     until it is registered here with a success-path invocation), and each records an audit event
//     with `actor.kind === 'staff'`;
//   * every read in the admin data layer (lib/data) records `staff.read` with actor kind `staff`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FlagKeys from '@causedeck/flags/keys';

import type * as DataLayer from '../lib/data/index.ts';
import type * as TwoFactor from '../lib/two-factor.ts';

interface FlagSink {
  write: (tx: unknown, event: { action: string; actorUserId: string }) => Promise<void>;
}

const mocks = vi.hoisted(() => ({
  record: vi.fn<(ctx: unknown, event: unknown) => Promise<void>>(() => Promise.resolve()),
  cookieSet: vi.fn(),
  /** The flag audit sink the admin app installed (lib/flags.ts), if any. */
  flagSink: { current: undefined as FlagSink | undefined },
}));

const STAFF_ID = '0192d3b0-0000-7000-8000-000000000310';
const SESSION_ID = '0192d3b0-0000-7000-8000-0000000003a0';
const SUPPORT_SESSION_ID = '0192d3b0-0000-7000-8000-0000000003b0';
const SUPPORT_WORKSPACE_ID = '0192d3b0-0000-7000-8000-0000000003c0';
const WORKSPACE_ID = '0192d3b0-0000-7000-8000-000000000224';
const OVERRIDE_ID = '0192d3b0-0000-7000-8000-0000000002a4';

/** A core usage write: records its audit event with the staff actor, as limits.ts does. */
function auditedOverrideWrite(action: string) {
  return (_ctx: unknown, input: { staffUserId: string }) =>
    mocks.record({ actor: { userId: input.staffUserId, kind: 'staff' } }, { action });
}

vi.mock('@causedeck/core/audit', () => ({
  record: mocks.record,
  // As the real sink: every flag event is a record() with actor kind staff (security-events.ts).
  flagChangeAuditSink: {
    write: (_tx: unknown, event: { action: string; actorUserId: string }) =>
      mocks.record(
        { actor: { kind: 'staff', userId: event.actorUserId } },
        { action: event.action },
      ),
  },
}));
// Core audits a support session's lifecycle (`support.session_*`) with the staff actor it is handed
// (#314); the mocks below stand in for core and record the same staff-actor event.
vi.mock('@causedeck/core/runtime', () => ({
  db: {},
  requestSupportSessionFor: async (ctx: { staffUserId: string }) => {
    await mocks.record(
      { actor: { kind: 'staff', userId: ctx.staffUserId } },
      { action: 'support.session_requested' },
    );
    return { id: SUPPORT_SESSION_ID };
  },
  staffSupportSessionFor: () =>
    Promise.resolve({ id: SUPPORT_SESSION_ID, workspaceId: SUPPORT_WORKSPACE_ID }),
  revokeSupportSessionFor: async (ctx: { userId: string }) => {
    await mocks.record(
      { actor: { kind: 'staff', userId: ctx.userId } },
      { action: 'support.session_ended' },
    );
    return { id: SUPPORT_SESSION_ID };
  },
}));
// The source registry audits `source.changed` in its own transaction with the staff actor (#478).
vi.mock('@causedeck/core/sources', () => {
  const audited = (_db: unknown, actor: { userId: string }) =>
    mocks.record({ actor: { userId: actor.userId, kind: 'staff' } }, { action: 'source.changed' });
  return {
    SOURCE_KINDS: ['court', 'notice', 'news', 'licensed', 'corpus'],
    SOURCE_ACCESS_MODES: ['A0', 'A1', 'A2', 'A3'],
    SOURCE_MAX_TIERS: ['http', 'headless', 'proxy', 'captcha'],
    SOURCE_REVIEW_STATUSES: ['pending', 'cleared', 'rejected'],
    SOURCE_DATA_CLASSES: ['personal', 'non-personal', 'mixed'],
    SourceAdminError: class SourceAdminError extends Error {},
    asSourceStaff: (userId: string) => ({ userId }),
    listSources: () => Promise.resolve([]),
    sourceFetchLogs: () => Promise.resolve([]),
    sourceOpsOverview: () => Promise.resolve([]),
    staffParseYield: () => Promise.resolve([]),
    createSource: audited,
    updateSource: audited,
    setSourceKillSwitch: audited,
  };
});
vi.mock('@causedeck/core/workspaces', () => ({
  WorkspaceError: class WorkspaceError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));
vi.mock('../lib/two-factor.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof TwoFactor>()),
  verifyTwoFactorCookie: () => true,
}));
vi.mock('@causedeck/core/support', () => ({
  isActiveStaff: () => Promise.resolve(true),
  countActiveStaff: () => Promise.resolve(1),
  staffMember: () => Promise.resolve({ userId: STAFF_ID, role: 'admin' }),
  SUPPORT_REASON_MAX_LENGTH: 1000,
  staffWorkspaceSearch: () => Promise.resolve([]),
  staffWorkspaceMetadata: () => Promise.resolve(null),
  staffAuditEvents: () => Promise.resolve([]),
  staffWorkspaceUsage: () => Promise.resolve(null),
}));
vi.mock('@causedeck/core/usage', () => ({
  setBudgetOverride: auditedOverrideWrite('usage.budget_override_set'),
  expireBudgetOverride: auditedOverrideWrite('usage.budget_override_expired'),
}));
vi.mock('@causedeck/db', () => ({
  withoutWorkspace: (_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({}),
}));
// Flag writes audit through the installed flag audit sink (packages/flags/src/admin.ts); these
// fakes do the same, so an action whose module did not install the real sink fails here.
vi.mock('@causedeck/flags', async () => {
  const keys = await vi.importActual<typeof FlagKeys>('@causedeck/flags/keys');
  const audited =
    (action: string) =>
    (_db: unknown, actor: { userId: string }): Promise<void> =>
      mocks.flagSink.current
        ? mocks.flagSink.current.write({}, { action, actorUserId: actor.userId })
        : Promise.reject(new Error('flag audit sink not installed'));
  class FlagAdminError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ...keys,
    listAccessModeRegistry: () => Promise.resolve([]),
    asStaff: (userId: string) => ({ userId }),
    FlagAdminError,
    setFlagAuditSink: (sink: FlagSink | null) => {
      mocks.flagSink.current = sink ?? undefined;
    },
    setFlag: audited('flag.changed'),
    setWorkspaceFlag: audited('flag.changed'),
    requestLegalEnable: audited('flag.change_requested'),
    approveLegalEnable: audited('flag.change_approved'),
    rejectLegalEnable: audited('flag.change_rejected'),
  };
});
vi.mock('../lib/staff.ts', () => ({
  requireStaff: () =>
    Promise.resolve({ userId: STAFF_ID, email: 'admin@causedeck.test', role: 'admin' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@causedeck/auth/rate-limit', () => ({ consumeRateLimit: () => Promise.resolve(true) }));
vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve(new Headers({ 'user-agent': 'vitest', 'x-real-ip': '203.0.113.7' })),
  cookies: () => Promise.resolve({ get: () => undefined, set: mocks.cookieSet }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  },
}));
vi.mock('../lib/auth.ts', () => ({
  sessionFor: () =>
    Promise.resolve({
      session: { id: SESSION_ID },
      user: { id: STAFF_ID, email: 'ops@causedeck.test', twoFactorEnabled: true },
    }),
  getAuth: () => ({ api: { verifyTOTP: () => Promise.resolve({}) } }),
}));
vi.mock('../lib/env.ts', () => ({
  adminEnv: () => ({
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: { reveal: () => 'x'.repeat(32) },
  }),
}));

const ADMIN_ROOT = path.resolve(import.meta.dirname, '..');
const APP_DIR = path.join(ADMIN_ROOT, 'app');

/** Each admin server action, `<file relative to apps/admin>#<export>`, and its success path. */
const REQUEST_ID = '0192d3b0-0000-7000-8000-0000000003b1';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

const FIXTURE_FIELDS = {
  adapterId: 'echo',
  format: 'text',
  name: 'list-80-audit',
  document: 'ECHO TEST COURT (FICTIONAL)\nCAUSE LIST FOR 21.10.2026\nCOURT HALL 1\nFOR ADMISSION\n',
};

const ACTIONS: Record<string, () => Promise<unknown>> = {
  'app/(console)/fixtures/actions.ts#previewFixtureAction': async () => {
    const { previewFixtureAction } = await import('../app/(console)/fixtures/actions.ts');
    return previewFixtureAction({}, form(FIXTURE_FIELDS));
  },
  'app/(console)/fixtures/actions.ts#buildFixtureAction': async () => {
    const { buildFixtureAction } = await import('../app/(console)/fixtures/actions.ts');
    return buildFixtureAction({}, form(FIXTURE_FIELDS));
  },
  'app/(console)/flags/actions.ts#setFlagAction': async () => {
    const { setFlagAction } = await import('../app/(console)/flags/actions.ts');
    return setFlagAction({}, form({ key: 'pwa.offline', enabled: 'true' }));
  },
  'app/(console)/flags/actions.ts#requestLegalEnableAction': async () => {
    const { requestLegalEnableAction } = await import('../app/(console)/flags/actions.ts');
    return requestLegalEnableAction(
      {},
      form({ key: 'invoices.enabled', note: 'Counsel #120', acknowledged: 'on', code: '123456' }),
    );
  },
  'app/(console)/flags/actions.ts#approveLegalEnableAction': async () => {
    const { approveLegalEnableAction } = await import('../app/(console)/flags/actions.ts');
    return approveLegalEnableAction({}, form({ requestId: REQUEST_ID, code: '123456' }));
  },
  'app/(console)/flags/actions.ts#rejectLegalEnableAction': async () => {
    const { rejectLegalEnableAction } = await import('../app/(console)/flags/actions.ts');
    return rejectLegalEnableAction({}, form({ requestId: REQUEST_ID }));
  },
  'app/(console)/support/actions.ts#requestSupportSessionAction': async () => {
    const { requestSupportSessionAction } = await import('../app/(console)/support/actions.ts');
    return requestSupportSessionAction(
      {},
      form({
        workspaceId: SUPPORT_WORKSPACE_ID,
        reason: 'Customer asked us to look at a failing import',
        scope: 'view',
      }),
    );
  },
  'app/(console)/support/actions.ts#endSupportSessionAction': async () => {
    const { endSupportSessionAction } = await import('../app/(console)/support/actions.ts');
    return endSupportSessionAction(form({ sessionId: SUPPORT_SESSION_ID }));
  },
  'app/(console)/sources/actions.ts#saveSourceAction': async () => {
    const { saveSourceAction } = await import('../app/(console)/sources/actions.ts');
    return saveSourceAction(
      form({
        mode: 'update',
        id: 'in.nclt.bengaluru',
        kind: 'court',
        baseUrl: 'https://nclt.gov.in',
        owner: 'NCLT',
        accessMode: 'A1',
        termsStatus: 'pending',
        counselStatus: 'pending',
        rateLimitPerMinute: '2',
        retentionDays: '30',
        residency: 'in',
        maxTier: 'http',
        maxCostDollars: '0',
        killSwitch: 'false',
        notes: '',
      }),
    );
  },
  'app/(console)/sources/actions.ts#setSourceKillSwitchAction': async () => {
    const { setSourceKillSwitchAction } = await import('../app/(console)/sources/actions.ts');
    return setSourceKillSwitchAction(form({ id: 'in.nclt.bengaluru', killSwitch: 'true' }));
  },
  'app/verify-2fa/actions.ts#verifyTwoFactor': async () => {
    const { verifyTwoFactor } = await import('../app/verify-2fa/actions.ts');
    const form = new FormData();
    form.set('code', '123456');
    return verifyTwoFactor({}, form);
  },
  'app/(console)/workspaces/[id]/actions.ts#setBudgetOverrideAction': async () => {
    const { setBudgetOverrideAction } = await import('../app/(console)/workspaces/[id]/actions.ts');
    const form = new FormData();
    form.set('workspaceId', WORKSPACE_ID);
    form.set('limitRupees', '350');
    form.set('expiresAt', '2999-01-01T00:00');
    form.set('reason', 'pilot extension');
    return setBudgetOverrideAction({}, form);
  },
  'app/(console)/workspaces/[id]/actions.ts#expireBudgetOverrideAction': async () => {
    const { expireBudgetOverrideAction } =
      await import('../app/(console)/workspaces/[id]/actions.ts');
    const form = new FormData();
    form.set('workspaceId', WORKSPACE_ID);
    form.set('overrideId', OVERRIDE_ID);
    form.set('reason', 'pilot ended');
    return expireBudgetOverrideAction({}, form);
  },
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

/** `file#export` for every export of a module whose code starts with the `'use server'` directive. */
function serverActions(): string[] {
  const found: string[] = [];
  for (const file of sources(APP_DIR)) {
    const text = readFileSync(file, 'utf8');
    const code = text.replace(/^(\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*/, '').trimStart();
    const moduleLevel = /^['"]use server['"]/.test(code);
    // Inline `'use server'` inside a function body is not used in apps/admin; refuse it so the
    // enumeration stays complete.
    expect(
      moduleLevel || !/['"]use server['"]/.test(text),
      `${path.relative(ADMIN_ROOT, file)} has an inline 'use server'`,
    ).toBe(true);
    if (!moduleLevel) continue;
    const rel = path.relative(ADMIN_ROOT, file).split(path.sep).join('/');
    for (const [, name] of text.matchAll(
      /^export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+)([A-Za-z_$][\w$]*)/gm,
    )) {
      found.push(`${rel}#${name ?? ''}`);
    }
    for (const [, names] of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const n of (names ?? '').split(',')) {
        const exported = n
          .trim()
          .split(/\s+as\s+/)
          .pop();
        if (exported) found.push(`${rel}#${exported}`);
      }
    }
  }
  return found.sort();
}

function staffEvents(): { actor: { kind: string; userId: string }; action: string }[] {
  return mocks.record.mock.calls.map(([ctx, event]) => ({
    actor: (ctx as { actor: { kind: string; userId: string } }).actor,
    action: (event as { action: string }).action,
  }));
}

beforeEach(() => {
  mocks.record.mockClear();
  mocks.cookieSet.mockClear();
});

describe('admin server actions', () => {
  it('are all registered here (a new action must add its audited success path)', () => {
    const actions = serverActions();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions).toEqual(Object.keys(ACTIONS).sort());
  });

  it.each(Object.keys(ACTIONS))('%s records an audit event with actor kind staff', async (key) => {
    const run = ACTIONS[key];
    if (run === undefined) throw new Error(`no invocation for ${key}`);
    // Next.js ends a successful action with redirect(), which throws.
    await run().catch((error: unknown) => {
      if ((error as Error).message !== 'NEXT_REDIRECT') throw error;
    });
    const events = staffEvents();
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.actor).toEqual({ kind: 'staff', userId: STAFF_ID });
  });
});

describe('admin data layer reads', () => {
  const staff = { userId: STAFF_ID, role: 'admin' as const };
  const READS: Record<string, (data: typeof DataLayer) => Promise<unknown>> = {
    activeStaffCount: (d) => d.activeStaffCount(staff),
    adapterRegistry: (d) => d.adapterRegistry(staff),
    sourceRegistry: (d) => d.sourceRegistry(staff),
    searchWorkspaces: (d) => d.searchWorkspaces(staff, 'chambers'),
    workspaceMetadata: (d) => d.workspaceMetadata(staff, STAFF_ID),
    staffAuditLog: (d) => d.staffAuditLog(staff),
    workspaceUsage: (d) => d.workspaceUsage(staff, WORKSPACE_ID),
    dataOpsOverview: (d) => d.dataOpsOverview(staff),
    dataOpsFetchLogs: (d) => d.dataOpsFetchLogs(staff, 'court.test'),
  };
  // Reads made of more than one audited step: parse yield (definer function), then the tables.
  const READ_EVENTS: Record<string, number> = { dataOpsOverview: 2 };
  // The building blocks every read goes through, not reads themselves.
  const PRIMITIVES = ['staffCall', 'staffQuery', 'StaffQueryDeniedError'];

  it('are all registered here', async () => {
    const data = await import('../lib/data/index.ts');
    const reads = Object.keys(data).filter((name) => !PRIMITIVES.includes(name));
    expect(reads.sort()).toEqual(Object.keys(READS).sort());
  });

  it.each(Object.keys(READS))('%s records staff.read with actor kind staff', async (name) => {
    const data = await import('../lib/data/index.ts');
    await READS[name]?.(data);
    expect(staffEvents()).toEqual(
      Array.from({ length: READ_EVENTS[name] ?? 1 }, () => ({
        actor: { kind: 'staff', userId: STAFF_ID },
        action: 'staff.read',
      })),
    );
  });
});
