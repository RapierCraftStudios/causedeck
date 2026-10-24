// Case-status watch actions and the refresh orchestrator (#593, D-048 tier 4). With the legal-gated
// flag `court.case-status` off every action is NOT_FOUND before core runs; a refresh reports the
// tier used and the cost (the provenance of the server fallback) and calls core with the web
// fetcher; a device-read body is validated against the parsed-status schema before core stores it;
// `refreshStatus` tries the device first and falls back to the server on absence, an unrecognised
// page or a failure, and never needs a captcha.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';
import type { RefreshActions } from '../lib/case-watch/refresh.ts';
import { refreshStatus } from '../lib/case-watch/refresh.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const WATCH = '00000000-0000-4000-8000-0000000d0001';
const PROCEEDING = '00000000-0000-4000-8000-0000000e0001';

const state = vi.hoisted((): { session: AppSession | null; flag: boolean } => ({
  session: null,
  flag: true,
}));
const runtime = vi.hoisted(() => ({
  memberRoleFor: vi.fn(() => Promise.resolve('owner')),
  ownerGraceFor: vi.fn(() => Promise.resolve(null)),
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
  recordAccessDeniedFor: vi.fn(() => Promise.resolve()),
}));
const core = vi.hoisted(() => ({
  STATUS_SOURCES: { 'in.tn.chennai-district:case_status': {} },
  listCaseWatches: vi.fn(),
  addCaseWatch: vi.fn(),
  removeCaseWatch: vi.fn(),
  runCaseStatusLookup: vi.fn(),
  recordDeviceSnapshot: vi.fn(),
}));
const fetcher = vi.hoisted(() => ({
  webStatusFetcher: vi.fn(() => ({
    fetcher: { fetchSource: vi.fn() },
    provenance: () => ({ tierUsed: 'alterlab-t2', costDollars: 0.0123 }),
  })),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth.ts', () => ({
  getSession: () => Promise.resolve(state.session),
  requireSession: () =>
    state.session
      ? Promise.resolve(state.session)
      : Promise.reject(Object.assign(new Error('signed out'), { code: 'UNAUTHENTICATED' })),
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/case-watch', () => core);
vi.mock('@causedeck/flags/server', () => ({ isEnabled: () => Promise.resolve(state.flag) }));
vi.mock('../lib/case-watch/fetcher.ts', () => fetcher);
vi.mock('next/cache', () => ({ revalidatePath }));

const actions = await import('../app/(app)/w/[slug]/settings/case-watch/actions.ts');

const STATUS = {
  template: 'ecourts-district',
  status: 'ok',
  cnr: 'KABC010012342024',
  caseNumber: null,
  nextHearingDate: '2026-11-02',
  lastHearingDate: null,
  stage: null,
  bench: null,
  orders: [],
  quotes: {},
};

beforeEach(() => {
  state.flag = true;
  state.session = {
    user: { id: USER, email: 'a@example.com', name: 'A' },
    session: { id: 's1' },
  } as unknown as AppSession;
  core.runCaseStatusLookup.mockResolvedValue({ outcome: 'changed', proposals: 1 });
  core.recordDeviceSnapshot.mockResolvedValue({ outcome: 'changed', proposals: 1 });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('case-watch actions', () => {
  it('is NOT_FOUND for every action while court.case-status is off, and core never runs', async () => {
    state.flag = false;
    // Sequential: concurrent first imports of the mocked auth module race in vitest.
    const results = [];
    results.push(await actions.listCaseWatchesAction({ workspaceId: WS }));
    results.push(await actions.removeCaseWatchAction({ workspaceId: WS, watchId: WATCH }));
    results.push(await actions.refreshCaseStatusAction({ workspaceId: WS, watchId: WATCH }));
    results.push(
      await actions.recordDeviceStatusAction({ workspaceId: WS, watchId: WATCH, status: STATUS }),
    );
    results.push(
      await actions.addCaseWatchAction({
        workspaceId: WS,
        proceedingId: PROCEEDING,
        sourceId: 'in.tn.chennai-district:case_status',
        cnr: 'KABC010012342024',
      }),
    );
    for (const result of results)
      expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(core.runCaseStatusLookup).not.toHaveBeenCalled();
    expect(core.recordDeviceSnapshot).not.toHaveBeenCalled();
    expect(core.addCaseWatch).not.toHaveBeenCalled();
  });

  it('refresh returns the outcome with the tier used and the cost, via the web fetcher', async () => {
    const result = await actions.refreshCaseStatusAction({ workspaceId: WS, watchId: WATCH });
    expect(result).toEqual({
      ok: true,
      data: { outcome: 'changed', proposals: 1, tierUsed: 'alterlab-t2', costDollars: 0.0123 },
    });
    const [deps, actor, args] = core.runCaseStatusLookup.mock.calls[0] as unknown[];
    expect(Object.keys(deps as object).sort()).toEqual(['db', 'fetcher']);
    expect(actor).toEqual({ workspaceId: WS, userId: USER });
    expect(args).toEqual({ watchId: WATCH });
  });

  it('maps an uncleared source or a denied fetch to FORBIDDEN, never INTERNAL', async () => {
    core.runCaseStatusLookup.mockRejectedValue(
      Object.assign(new Error('kill switch'), { name: 'FetchDenied' }),
    );
    expect(
      await actions.refreshCaseStatusAction({ workspaceId: WS, watchId: WATCH }),
    ).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejects an unknown source and an invalid device body before core', async () => {
    expect(
      await actions.addCaseWatchAction({
        workspaceId: WS,
        proceedingId: PROCEEDING,
        sourceId: 'nope',
        cnr: 'KABC010012342024',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const bad = await actions.recordDeviceStatusAction({
      workspaceId: WS,
      watchId: WATCH,
      status: { ...STATUS, template: 'made-up', orders: 'x' },
    });
    expect(bad).toMatchObject({ ok: false });
    expect(core.recordDeviceSnapshot).not.toHaveBeenCalled();
    expect(core.addCaseWatch).not.toHaveBeenCalled();
  });

  it('stores a valid device body through core under the caller', async () => {
    const result = await actions.recordDeviceStatusAction({
      workspaceId: WS,
      watchId: WATCH,
      status: STATUS,
    });
    expect(result).toEqual({ ok: true, data: { outcome: 'changed', proposals: 1 } });
    expect(core.recordDeviceSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      { workspaceId: WS, userId: USER },
      { watchId: WATCH, status: STATUS },
    );
  });
});

describe('refreshStatus', () => {
  const input = { workspaceId: WS, watchId: WATCH };
  const served = {
    ok: true as const,
    data: { outcome: 'unchanged' as const, proposals: 0, tierUsed: 't1', costDollars: 0.5 },
  };
  const mk = (): RefreshActions => ({
    server: vi.fn(() => Promise.resolve(served)),
    recordDevice: vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { outcome: 'changed' as const, proposals: 2 } }),
    ),
  });

  it('uses the device first and does not call the server when it reads the page', async () => {
    const actionsStub = mk();
    const result = await refreshStatus(input, actionsStub, () => Promise.resolve(STATUS as never));
    expect(result).toEqual({ via: 'device', outcome: 'changed', proposals: 2 });
    expect(actionsStub.server).not.toHaveBeenCalled();
  });

  it.each([
    ['no device solver', undefined],
    ['a device that cannot read', () => Promise.resolve(null)],
    ['an unrecognised page', () => Promise.resolve({ ...STATUS, status: 'unrecognised' } as never)],
    ['a device that throws', () => Promise.reject(new Error('ocr'))],
  ])('falls back to the server with its provenance on %s', async (_name, device) => {
    const actionsStub = mk();
    const result = await refreshStatus(input, actionsStub, device);
    expect(result).toEqual({ via: 'server', ...served.data });
    expect(actionsStub.recordDevice).not.toHaveBeenCalled();
  });

  it('falls back to the server when the device status is rejected, and reports failure last', async () => {
    const actionsStub = mk();
    actionsStub.recordDevice = vi.fn(() =>
      Promise.resolve({ ok: false as const, code: 'VALIDATION', message: 'bad' } as never),
    );
    expect(
      (await refreshStatus(input, actionsStub, () => Promise.resolve(STATUS as never))).via,
    ).toBe('server');
    actionsStub.server = vi.fn(() =>
      Promise.resolve({ ok: false as const, code: 'FORBIDDEN', message: '' } as never),
    );
    expect(await refreshStatus(input, actionsStub)).toEqual({ via: 'failed' });
  });
});
