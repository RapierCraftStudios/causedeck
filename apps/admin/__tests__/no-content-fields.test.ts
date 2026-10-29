// By default staff see only workspace metadata (#310, part of #27): plan, seat count, storage
// bytes, created/last-active dates and flags. This reads two fully seeded workspaces (a row in every
// tenant table) through the admin data layer and the Workspaces / Audit pages, and fails if any
// matter, document, memory, party or draft field, or another member's email, reaches a response.
import { randomUUID } from 'node:crypto';

import {
  STAFF_AUDIT_FIELDS,
  STAFF_BUDGET_OVERRIDE_FIELDS,
  STAFF_USAGE_COUNTER_FIELDS,
  STAFF_WORKSPACE_FIELDS,
} from '@causedeck/core/support';
import { asIncidentStaff, createIncident } from '@causedeck/core/status';
import { setBudgetOverride } from '@causedeck/core/usage';
import type { Transaction } from '@causedeck/db';
import { closeTestDb, inWorkspace, schema, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { sql } from 'drizzle-orm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { committedStaff, type StaffFixture } from './staff-fixture.ts';

// The runtime handle forwards to the current test transaction, so every read (and its staff.read
// audit event) runs inside withTestDb and is rolled back.
const state = vi.hoisted((): { tx: unknown; staff: unknown } => ({
  tx: undefined,
  staff: undefined,
}));

vi.mock('@causedeck/core/runtime', () => ({
  db: new Proxy(
    {},
    {
      get: (_target, prop) => {
        const tx = state.tx as Record<string | symbol, unknown> | undefined;
        if (tx === undefined) throw new Error('no test transaction');
        const value = Reflect.get(tx, prop, tx);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(tx)
          : value;
      },
      getPrototypeOf: () => Object.getPrototypeOf(state.tx) as object | null,
    },
  ),
}));
vi.mock('../lib/staff.ts', () => ({ requireStaff: () => Promise.resolve(state.staff) }));

const {
  growthFunnel,
  incidentConsole,
  searchWorkspaces,
  staffAuditLog,
  workspaceMetadata,
  workspaceUsage,
} = await import('../lib/data/index.ts');
const { default: WorkspacesPage } = await import('../app/(console)/workspaces/page.tsx');
const { default: WorkspacePage } = await import('../app/(console)/workspaces/[id]/page.tsx');
const { default: AuditPage } = await import('../app/(console)/audit/page.tsx');
const { default: StatusPage } = await import('../app/(console)/status/page.tsx');

/** Words that name workspace content; none may appear as a key or in rendered HTML. */
const CONTENT = /\b(matters?|documents?|memor(y|ies)|part(y|ies)|drafts?)\b/i;

let staffFixture: StaffFixture;

beforeAll(async () => {
  staffFixture = await committedStaff('admin');
  state.staff = { userId: staffFixture.userId, email: staffFixture.email, role: 'admin' };
});

afterAll(async () => {
  await staffFixture.cleanup();
  await closeTestDb();
});

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

async function emails(tx: Transaction, ids: string[]): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(sql`${schema.user.id} in ${ids}`);
  return ids.map((id) => rows.find((r) => r.id === id)?.email ?? '');
}

/** Seed A and B, and a staff support read of A's content (target and metadata name a matter). */
async function seed(tx: Transaction): Promise<TwoTenants> {
  const t = await seedTwoTenants(tx);
  await inWorkspace(tx, t.a.id, (s) =>
    s.execute(sql`select app_audit_append(${t.a.id}::uuid, ${staffFixture.userId}::uuid, 'staff',
      'support.view', 'matter', ${randomUUID()}, 'success', null, null, null,
      jsonb_build_object('supportSessionId', ${randomUUID()}::text, 'readAction', 'matter.read',
                         'targetKinds', 'matter,document'))`),
  );
  // A staff AI budget override of A (#224); its reason is staff-written, neutral text.
  await setBudgetOverride(
    { db: tx, workspaceId: t.a.id },
    {
      limitPaise: 35_000,
      reason: 'pilot extension',
      expiresAt: new Date(Date.now() + 86_400_000),
      staffUserId: staffFixture.userId,
    },
  );
  return t;
}

async function html(element: Promise<ReactElement>): Promise<string> {
  return renderToStaticMarkup(await element);
}

describe('staff console responses carry metadata only', () => {
  it('the data layer returns exactly the metadata fields', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const t = await seed(tx);
      const found = await searchWorkspaces(state.staff as never, t.a.slug);
      const one = await workspaceMetadata(state.staff as never, t.b.id);
      const audit = await staffAuditLog(state.staff as never);
      expect(found.map((w) => w.workspaceId)).toEqual([t.a.id]);
      for (const w of [...found, one]) {
        expect(Object.keys(w ?? {}).sort()).toEqual([...STAFF_WORKSPACE_FIELDS].sort());
      }
      expect(audit.length).toBeGreaterThan(0);
      for (const e of audit) expect(Object.keys(e).sort()).toEqual([...STAFF_AUDIT_FIELDS].sort());
      const keys = keysDeep([found, one, audit]);
      expect(keys.filter((k) => CONTENT.test(k.replace(/([a-z])([A-Z])/g, '$1 $2')))).toEqual([]);
      // Nothing from audit metadata or the event target leaks into the entries.
      expect(JSON.stringify(audit)).not.toMatch(CONTENT);
      // Usage (#224): counters and overrides carry exactly their metadata fields.
      const usage = await workspaceUsage(state.staff as never, t.a.id);
      expect(usage?.overrides.length).toBeGreaterThan(0);
      expect(usage?.counters.length).toBeGreaterThan(0);
      for (const c of usage?.counters ?? []) {
        expect(Object.keys(c).sort()).toEqual([...STAFF_USAGE_COUNTER_FIELDS].sort());
      }
      for (const o of usage?.overrides ?? []) {
        expect(Object.keys(o).sort()).toEqual([...STAFF_BUDGET_OVERRIDE_FIELDS].sort());
      }
      const usageKeys = keysDeep(usage);
      expect(usageKeys.filter((k) => CONTENT.test(k.replace(/([a-z])([A-Z])/g, '$1 $2')))).toEqual(
        [],
      );
      expect(JSON.stringify(usage)).not.toMatch(CONTENT);
    });
  });

  it('the Workspaces, Workspace and Audit pages render no content fields or member emails', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const t = await seed(tx);
      const [ownerEmail, otherEmail] = await emails(tx, [t.ua, t.uboth]);
      const pages = [
        await html(WorkspacesPage({ searchParams: Promise.resolve({ q: t.a.slug }) })),
        await html(WorkspacePage({ params: Promise.resolve({ id: t.a.id }) })),
        await html(AuditPage({ searchParams: Promise.resolve({}) })),
      ];
      expect(pages[0]).toContain(t.a.slug);
      expect(pages[1]).toContain(ownerEmail);
      // The usage section (#224) renders on the workspace page, metadata only.
      expect(pages[1]).toContain('AI budget overrides');
      expect(pages[1]).toContain('pilot extension');
      expect(pages[2]).toContain('support.view');
      for (const page of pages) {
        const text = page.replace(/<[^>]+>/g, ' ');
        expect(text).not.toMatch(CONTENT);
        expect(text).not.toContain(otherEmail);
      }
    });
  });
});

describe('the growth funnel carries counts only (#509)', () => {
  it('returns no user id, email or content word', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const t = await seed(tx);
      await tx.insert(schema.activationEvent).values([
        { userId: t.ua, step: 'signed_up', channel: 'direct', occurredAt: new Date('2031-03-03') },
        { userId: t.ua, step: 'first_court_day_view', occurredAt: new Date('2031-03-04') },
      ]);
      const funnel = await growthFunnel(state.staff as never, { since: new Date('2031-01-01') });
      expect(funnel.cohorts.length).toBeGreaterThan(0);
      const json = JSON.stringify(funnel);
      expect(json).not.toContain(t.ua);
      for (const email of await emails(tx, [t.ua])) expect(json).not.toContain(email);
      expect(json).not.toMatch(CONTENT);
      expect(keysDeep(funnel).filter((k) => /id$|email|name/i.test(k))).toEqual([]);
    });
  });
});

describe('the status console carries public incident text only (#770)', () => {
  it('the data read and the page name no tenant id, email or content word', async () => {
    await withTestDb(async (tx) => {
      state.tx = tx;
      const t = await seed(tx);
      await createIncident(tx, asIncidentStaff(staffFixture.userId), {
        title: 'Court lookups are slow',
        severity: 'degraded',
        component: 'court',
      });
      const incidents = await incidentConsole(state.staff as never);
      expect(incidents.length).toBeGreaterThan(0);
      const page = (await html(StatusPage({ searchParams: Promise.resolve({}) }))).replace(
        /<[^>]+>/g,
        ' ',
      );
      expect(page).toContain('Court lookups are slow');
      const json = JSON.stringify(incidents);
      const others = [t.a.id, t.b.id, t.a.slug, t.b.slug, ...(await emails(tx, [t.ua, t.uboth]))];
      for (const text of [json, page]) {
        for (const value of others) expect(text).not.toContain(value);
        expect(text).not.toMatch(CONTENT);
      }
      expect(keysDeep(incidents).filter((k) => /workspace|email|user/i.test(k))).toEqual([]);
    });
  });
});
