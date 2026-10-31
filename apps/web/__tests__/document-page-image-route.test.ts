// `/api/documents/[id]/pages/[page]/image` (#489): 401 signed out, 400 bad input, the guard's
// refusal, 404 for a missing document, page or image, and a streamed private image otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  guard: vi.fn(),
  open: vi.fn(),
}));

vi.mock('../lib/auth.ts', () => ({ getSession: () => Promise.resolve(state.session) }));
vi.mock('../lib/env.ts', () => ({ serverEnv: () => ({}) }));
vi.mock('../lib/storage.ts', () => ({ objectStore: () => ({}) }));
vi.mock('@causedeck/storage', () => ({ EnvKeyProvider: { fromEnv: () => ({}) } }));
vi.mock('../lib/guard.ts', () => ({
  guard: state.guard,
  guardResponse: (error: unknown) =>
    error instanceof Error && error.message === 'DENIED'
      ? Response.json({ error: 'forbidden' }, { status: 403 })
      : null,
}));
vi.mock('@causedeck/core/runtime', () => ({ openDocumentPageImageFor: state.open }));
vi.mock('@causedeck/core/workspaces', () => ({
  WorkspaceError: class WorkspaceError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { GET } = await import('../app/api/documents/[id]/pages/[page]/image/route.ts');
const { WorkspaceError } = await import('@causedeck/core/workspaces');

const WORKSPACE = '00000000-0000-4000-8000-00000000a001';
const DOCUMENT = '00000000-0000-4000-8000-00000000d001';
const USER = '00000000-0000-4000-8000-0000000000a1';

const call = (pageNo = '2', workspaceId: string | null = WORKSPACE, id = DOCUMENT) =>
  GET(
    new Request(
      `https://app.causedeck.test/api/documents/${id}/pages/${pageNo}/image${
        workspaceId === null ? '' : `?workspaceId=${workspaceId}`
      }`,
    ),
    { params: Promise.resolve({ id, page: pageNo }) },
  );

async function* bytes() {
  await Promise.resolve();
  yield new Uint8Array([1, 2, 3]);
}

beforeEach(() => {
  state.session = { user: { id: USER } };
  state.guard.mockResolvedValue({ userId: USER });
  state.open.mockResolvedValue({ body: bytes(), mime: 'image/webp' });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/documents/[id]/pages/[page]/image', () => {
  it('is 401 signed out and 400 for bad input, and reads nothing', async () => {
    state.session = null;
    expect((await call()).status).toBe(401);
    state.session = { user: { id: USER } };
    expect((await call('0')).status).toBe(400);
    expect((await call('x')).status).toBe(400);
    expect((await call('2', null)).status).toBe(400);
    expect((await call('2', WORKSPACE, 'not-a-uuid')).status).toBe(400);
    expect(state.open).not.toHaveBeenCalled();
  });

  it('answers with the guard refusal before reading', async () => {
    state.guard.mockRejectedValue(new Error('DENIED'));
    expect((await call()).status).toBe(403);
    expect(state.open).not.toHaveBeenCalled();
  });

  it('is 404 when core finds no document, page or image', async () => {
    state.open.mockRejectedValue(new WorkspaceError('NOT_FOUND', 'Document not found'));
    expect((await call()).status).toBe(404);
  });

  it('streams the decrypted image as a private, non-sniffed response', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(state.open).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE, userId: USER },
      { documentId: DOCUMENT, pageNo: 2 },
      expect.anything(),
    );
  });
});
