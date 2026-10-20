// Admin and support activity is audited with actor kind `staff` (#310, part of #27):
//   * every `'use server'` export under apps/admin/app is listed in ACTIONS below (a new action fails
//     until it is registered here with a success-path invocation), and each records an audit event
//     with `actor.kind === 'staff'`;
//   * every read in the admin data layer (lib/data) records `staff.read` with actor kind `staff`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DataLayer from '../lib/data/index.ts';

const mocks = vi.hoisted(() => ({
  record: vi.fn<(ctx: unknown, event: unknown) => Promise<void>>(() => Promise.resolve()),
  cookieSet: vi.fn(),
}));

const STAFF_ID = '0192d3b0-0000-7000-8000-000000000310';
const SESSION_ID = '0192d3b0-0000-7000-8000-0000000003a0';
const WORKSPACE_ID = '0192d3b0-0000-7000-8000-000000000224';
const OVERRIDE_ID = '0192d3b0-0000-7000-8000-0000000002a4';

/** A core usage write: records its audit event with the staff actor, as limits.ts does. */
function auditedOverrideWrite(action: string) {
  return (_ctx: unknown, input: { staffUserId: string }) =>
    mocks.record({ actor: { userId: input.staffUserId, kind: 'staff' } }, { action });
}

vi.mock('@causedeck/core/audit', () => ({ record: mocks.record }));
vi.mock('@causedeck/core/runtime', () => ({ db: {} }));
vi.mock('@causedeck/core/support', () => ({
  isActiveStaff: () => Promise.resolve(true),
  countActiveStaff: () => Promise.resolve(1),
  staffWorkspaceSearch: () => Promise.resolve([]),
  staffWorkspaceMetadata: () => Promise.resolve(null),
  staffAuditEvents: () => Promise.resolve([]),
  staffWorkspaceUsage: () => Promise.resolve(null),
}));
vi.mock('@causedeck/core/usage', () => ({
  setBudgetOverride: auditedOverrideWrite('usage.budget_override_set'),
  expireBudgetOverride: auditedOverrideWrite('usage.budget_override_expired'),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('../lib/staff.ts', () => ({
  requireStaff: () =>
    Promise.resolve({ userId: STAFF_ID, email: 'ops@causedeck.test', role: 'admin' }),
}));
vi.mock('@causedeck/db', () => ({
  withoutWorkspace: (_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({}),
}));
vi.mock('@causedeck/flags', () => ({ listAccessModeRegistry: () => Promise.resolve([]) }));
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
const ACTIONS: Record<string, () => Promise<unknown>> = {
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
    searchWorkspaces: (d) => d.searchWorkspaces(staff, 'chambers'),
    workspaceMetadata: (d) => d.workspaceMetadata(staff, STAFF_ID),
    staffAuditLog: (d) => d.staffAuditLog(staff),
    workspaceUsage: (d) => d.workspaceUsage(staff, WORKSPACE_ID),
  };
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
    expect(staffEvents()).toEqual([
      { actor: { kind: 'staff', userId: STAFF_ID }, action: 'staff.read' },
    ]);
  });
});
