// `GET /w/[slug]/billing/invoices/[id]/pdf` (#258): owners of the slug's workspace get the
// decrypted PDF as an attachment (never cached or sniffed); workspace B asking for A's invoice gets
// 404 (core finds nothing in B), a slug the caller is not a member of is 404 before any lookup, and
// roles without `invoices.read` are refused by `guard` before any lookup.
import type * as CoreBilling from '@causedeck/core/billing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS_A = '00000000-0000-4000-8000-0000000000a1';
const WS_B = '00000000-0000-4000-8000-0000000000b1';
const USER = '00000000-0000-4000-8000-000000000001';
const INVOICE_A = '00000000-0000-4000-8000-0000000000c1';
const PDF = Buffer.from('%PDF-1.4 test invoice');

interface Membership {
  id: string;
  slug: string;
  role: string;
}

interface State {
  session: { user: { id: string } } | null;
  memberships: Membership[];
  open: ReturnType<typeof vi.fn>;
}

const state: State = vi.hoisted(() => ({
  session: { user: { id: '00000000-0000-4000-8000-000000000001' } },
  memberships: [],
  open: vi.fn(),
}));

vi.mock('@causedeck/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: { marker: 'db' },
}));
vi.mock('../../../../../../../../../lib/auth.ts', () => ({
  requireSession: () =>
    state.session ? Promise.resolve(state.session) : Promise.reject(new Error('signed out')),
}));
vi.mock('../../../../../../../../../lib/env.ts', () => ({
  serverEnv: () => ({ KEK_BASE64: { reveal: () => Buffer.alloc(32).toString('base64') } }),
}));
vi.mock('../../../../../../../../../lib/storage.ts', () => ({
  objectStore: () => ({ marker: 'store' }),
}));
vi.mock('../../../../../../../../../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: (slug: string) => {
    const member = state.session ? state.memberships.find((m) => m.slug === slug) : undefined;
    return Promise.resolve(
      member
        ? {
            user: { id: USER, name: 'Owner', email: 'owner@example.test' },
            workspace: { id: member.id, slug: member.slug, name: member.slug },
            role: member.role,
            memberships: [],
          }
        : null,
    );
  },
}));
vi.mock('@causedeck/core/workspaces', () => ({
  memberRole: (_db: unknown, userId: string, workspaceId: string) =>
    Promise.resolve(
      userId === USER ? (state.memberships.find((m) => m.id === workspaceId)?.role ?? null) : null,
    ),
}));
vi.mock('@causedeck/core/billing', () => ({ openSaasInvoicePdf: state.open }));
vi.mock('@causedeck/storage', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EnvKeyProvider: { fromEnv: () => ({ marker: 'keys' }) },
}));

const route = await import('../route.ts');

function get(slug: string, id: string, headers: Record<string, string> = {}) {
  const request = new Request(`https://app.causedeck.test/w/${slug}/billing/invoices/${id}/pdf`, {
    headers,
  });
  return route.GET(request, { params: Promise.resolve({ slug, id }) });
}

/** Core's real cross-tenant behaviour: A's invoice exists only in workspace A. */
state.open.mockImplementation(
  (ctx: { workspaceId: string }, id: string): ReturnType<typeof CoreBilling.openSaasInvoicePdf> =>
    Promise.resolve(
      ctx.workspaceId === WS_A && id === INVOICE_A
        ? {
            number: 'CD/26-27/000001',
            filename: 'CD-26-27-000001.pdf',
            mime: 'application/pdf',
            stream: new Response(PDF).body ?? new ReadableStream(),
          }
        : null,
    ),
);

afterEach(() => {
  state.session = { user: { id: USER } };
  state.memberships = [];
  state.open.mockClear();
});

describe('GET /w/[slug]/billing/invoices/[id]/pdf', () => {
  it('streams the PDF to an owner as an uncached attachment, scoped to the slug workspace', async () => {
    state.memberships = [{ id: WS_A, slug: 'sharma', role: 'owner' }];
    const res = await get('sharma', INVOICE_A, {
      'x-request-id': 'req-1',
      'user-agent': 'vitest',
      'x-forwarded-for': '203.0.113.9, 10.0.0.1',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="CD-26-27-000001\.pdf"/,
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(state.open.mock.calls[0]).toEqual([
      {
        db: { marker: 'db' },
        store: { marker: 'store' },
        keys: { marker: 'keys' },
        workspaceId: WS_A,
        userId: USER,
        requestId: 'req-1',
        userAgent: 'vitest',
        ip: '203.0.113.9',
      },
      INVOICE_A,
    ]);
  });

  it("is 404 when workspace B asks for A's invoice (cross-tenant)", async () => {
    state.memberships = [
      { id: WS_A, slug: 'sharma', role: 'advocate' },
      { id: WS_B, slug: 'mehta', role: 'owner' },
    ];
    const res = await get('mehta', INVOICE_A);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(state.open.mock.calls[0]?.[0]).toMatchObject({ workspaceId: WS_B });
  });

  it('is 404 on a slug the caller is not a member of, before any lookup', async () => {
    state.memberships = [{ id: WS_B, slug: 'mehta', role: 'owner' }];
    const res = await get('sharma', INVOICE_A);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(state.open).not.toHaveBeenCalled();
  });

  it('is 404 when signed out, and for an unknown invoice id', async () => {
    state.memberships = [{ id: WS_A, slug: 'sharma', role: 'owner' }];
    expect((await get('sharma', '00000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    state.open.mockClear();
    state.session = null;
    expect((await get('sharma', INVOICE_A)).status).toBe(404);
    expect(state.open).not.toHaveBeenCalled();
  });

  it('refuses members without invoices.read (non-owners) before any lookup', async () => {
    for (const role of ['advocate', 'junior', 'clerk', 'viewer']) {
      state.memberships = [{ id: WS_A, slug: 'sharma', role }];
      const res = await get('sharma', INVOICE_A);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
    expect(state.open).not.toHaveBeenCalled();
  });
});
