// `pasteTextCaptureAction` (#1074): runs through `workspaceAction` with `document.write`, creates a
// manual capture on the workspace transaction (same pipeline as voice and camera) and answers the
// expected refusals as data.
import type { AppSession } from '../lib/auth.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const TX = { scoped: true };

const state = vi.hoisted((): { session: AppSession | null; role: string | null } => ({
  session: null,
  role: 'advocate',
}));

class NamedError extends Error {
  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

const core = vi.hoisted(() => ({
  memberRole: vi.fn(() => Promise.resolve(state.role)),
  ownerGrace: vi.fn(() =>
    Promise.resolve(state.role ? { role: state.role, roleGrantedAt: new Date() } : null),
  ),
}));
const capture = vi.hoisted(() => ({ createManualCapture: vi.fn() }));
const captureContext = vi.hoisted(() => vi.fn((input: unknown) => Promise.resolve({ ctx: input })));
const revalidatePath = vi.hoisted(() => vi.fn());
const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
);

vi.mock('../lib/auth.ts', () => ({
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
}));
vi.mock('../lib/storage.ts', () => ({ objectStore: () => ({ fake: 'store' }) }));
vi.mock('../lib/inbox/ready-providers.ts', () => ({ markReadySent: vi.fn() }));
vi.mock('../lib/outward/ready-provider.ts', () => ({}));
vi.mock('../lib/matters/graph-deps.ts', () => ({ graphDeps: vi.fn() }));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/core/workspaces', () => core);
vi.mock('@causedeck/core/capture', () => capture);
vi.mock('@causedeck/core/runtime', () => ({
  memberRoleFor: core.memberRole,
  ownerGraceFor: core.ownerGrace,
  captureContext,
  inWorkspace: (_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(TX),
}));
vi.mock('next/cache', () => ({ revalidatePath }));

const { pasteTextCaptureAction } = await import('../app/(app)/w/[slug]/inbox/actions.ts');

beforeEach(() => {
  state.session = {
    session: {},
    user: { id: USER, name: 'Meenakshi', email: 'm@x.test' },
  } as AppSession;
  state.role = 'advocate';
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('pasteTextCaptureAction', () => {
  it('creates a manual capture from the trimmed text on the workspace transaction', async () => {
    capture.createManualCapture.mockResolvedValue({ captureId: 'cap-1', status: 'queued' });
    const result = await pasteTextCaptureAction({ workspaceId: WS, text: '  Listed on 3 Dec  ' });
    expect(result).toEqual({ ok: true, data: { captureId: 'cap-1' } });
    expect(captureContext).toHaveBeenCalledWith(
      expect.objectContaining({ db: TX, workspaceId: WS, userId: USER }),
    );
    expect(capture.createManualCapture).toHaveBeenCalledWith(expect.anything(), {
      text: 'Listed on 3 Dec',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/w/[slug]/inbox', 'page');
  });

  it.each(['viewer'])('refuses a %s (no document.write) before any capture', async (role) => {
    state.role = role;
    const result = await pasteTextCaptureAction({ workspaceId: WS, text: 'x' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(capture.createManualCapture).not.toHaveBeenCalled();
  });

  it('rejects empty and oversize text as VALIDATION', async () => {
    for (const text of ['   ', 'a'.repeat(20_001)]) {
      expect(await pasteTextCaptureAction({ workspaceId: WS, text })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    expect(capture.createManualCapture).not.toHaveBeenCalled();
  });

  it('answers a switched-off channel and a size-cap refusal as data', async () => {
    capture.createManualCapture.mockRejectedValueOnce(new NamedError('ChannelDisabledError'));
    expect(await pasteTextCaptureAction({ workspaceId: WS, text: 'x' })).toEqual({
      ok: true,
      data: { error: 'channelOff' },
    });
    capture.createManualCapture.mockRejectedValueOnce(new NamedError('CaptureTooLargeError'));
    expect(await pasteTextCaptureAction({ workspaceId: WS, text: 'x' })).toEqual({
      ok: true,
      data: { error: 'tooLong' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure', async () => {
    capture.createManualCapture.mockRejectedValueOnce(new Error('db down'));
    const result = await pasteTextCaptureAction({ workspaceId: WS, text: 'x' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('db down');
  });

  it('requires a session', async () => {
    state.session = null;
    expect(await pasteTextCaptureAction({ workspaceId: WS, text: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});
