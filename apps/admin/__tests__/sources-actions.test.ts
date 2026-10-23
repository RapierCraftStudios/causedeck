// The sources page's server side (#478): every action needs the `sources` capability, input is
// validated, a refused change (a captcha court source) becomes a plain `?error=` message, and the
// kill switch and edits reach the core writer with the staff actor. `@causedeck/core/sources` is
// mocked; its DB behaviour and `source.changed` old/new audit are covered in core's registry test.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class SourceAdminError extends Error {}
  return {
    SourceAdminError,
    requireStaff: vi.fn(),
    createSource: vi.fn(),
    updateSource: vi.fn(),
    setSourceKillSwitch: vi.fn(),
  };
});

vi.mock('../lib/staff.ts', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@causedeck/core/runtime', () => ({ db: { tag: 'db' } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  },
}));
vi.mock('@causedeck/core/sources', () => ({
  SOURCE_KINDS: ['court', 'notice', 'news', 'licensed', 'corpus'],
  SOURCE_ACCESS_MODES: ['A0', 'A1', 'A2', 'A3'],
  SOURCE_MAX_TIERS: ['http', 'headless', 'proxy', 'captcha'],
  SOURCE_REVIEW_STATUSES: ['pending', 'cleared', 'rejected'],
  SourceAdminError: mocks.SourceAdminError,
  asSourceStaff: (userId: string) => ({ userId }),
  createSource: mocks.createSource,
  updateSource: mocks.updateSource,
  setSourceKillSwitch: mocks.setSourceKillSwitch,
}));

const { saveSourceAction, setSourceKillSwitchAction } =
  await import('../app/(console)/sources/actions.ts');

const STAFF = { userId: '0b6c1a52-8a3e-4d7f-9c1e-5f2a7b3c4d5e', email: 'ops@x.test', role: 'ops' };
const VALID = {
  mode: 'update',
  id: 'in.nclt.bengaluru',
  kind: 'court',
  baseUrl: 'https://nclt.gov.in',
  owner: 'NCLT',
  accessMode: 'A1',
  termsStatus: 'cleared',
  counselStatus: 'cleared',
  rateLimitPerMinute: '2',
  retentionDays: '30',
  residency: 'in',
  maxTier: 'http',
  maxCostDollars: '1.5',
  killSwitch: 'false',
  notes: '',
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => null,
    (e: unknown) => e as Error & { url?: string },
  );
  if (error?.message !== 'NEXT_REDIRECT') throw error ?? new Error('no redirect');
  return error.url ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStaff.mockResolvedValue(STAFF);
});

describe('saveSourceAction', () => {
  it('requires the sources capability before anything else', async () => {
    mocks.requireStaff.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(saveSourceAction(form(VALID))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.requireStaff).toHaveBeenCalledWith('sources');
    expect(mocks.updateSource).not.toHaveBeenCalled();
  });

  it('updates a source as the staff actor', async () => {
    const url = await redirectOf(saveSourceAction(form(VALID)));
    expect(url).toContain('/sources?done=');
    expect(mocks.updateSource).toHaveBeenCalledWith(
      { tag: 'db' },
      { userId: STAFF.userId },
      'in.nclt.bengaluru',
      expect.objectContaining({ kind: 'court', maxTier: 'http', maxCostDollars: 1.5, notes: null }),
    );
  });

  it('creates a source in create mode', async () => {
    await redirectOf(saveSourceAction(form({ ...VALID, mode: 'create' })));
    expect(mocks.createSource).toHaveBeenCalled();
    expect(mocks.updateSource).not.toHaveBeenCalled();
  });

  it('turns a refused captcha court source into an error message', async () => {
    mocks.updateSource.mockRejectedValue(
      new mocks.SourceAdminError('A court source cannot use the captcha tier'),
    );
    const url = await redirectOf(saveSourceAction(form({ ...VALID, maxTier: 'captcha' })));
    expect(url).toContain('/sources?error=');
    expect(decodeURIComponent(url)).toContain('captcha');
  });

  it('rejects unreadable input without calling core', async () => {
    const url = await redirectOf(saveSourceAction(form({ ...VALID, maxTier: 'warp' })));
    expect(url).toContain('?error=');
    expect(mocks.updateSource).not.toHaveBeenCalled();
  });
});

describe('setSourceKillSwitchAction', () => {
  it('flips the kill switch as the staff actor', async () => {
    const url = await redirectOf(
      setSourceKillSwitchAction(form({ id: 'in.nclt.bengaluru', killSwitch: 'true' })),
    );
    expect(decodeURIComponent(url)).toContain('kill switch is now on');
    expect(mocks.setSourceKillSwitch).toHaveBeenCalledWith(
      { tag: 'db' },
      { userId: STAFF.userId },
      'in.nclt.bengaluru',
      true,
    );
  });

  it('rejects a bad id', async () => {
    const url = await redirectOf(setSourceKillSwitchAction(form({ id: '', killSwitch: 'true' })));
    expect(url).toContain('?error=');
    expect(mocks.setSourceKillSwitch).not.toHaveBeenCalled();
  });
});
