// @vitest-environment jsdom
// The workspace usage section (#224): counters and overrides (active, expired, expired early),
// both empty states (also for a null read), forms for admin staff only; and the set/expire override actions, which refuse
// support staff and invalid input before reaching core, convert rupees to paise and revalidate.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaffBudgetOverride, StaffWorkspaceUsage } from '../lib/data/index.ts';

const mocks = vi.hoisted(() => ({
  setBudgetOverride: vi.fn(),
  expireBudgetOverride: vi.fn(),
  revalidatePath: vi.fn(),
  requireStaff: vi.fn(),
}));

vi.mock('../lib/staff.ts', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@causedeck/core/runtime', () => ({ db: { runtime: true } }));
vi.mock('@causedeck/core/usage', () => ({
  setBudgetOverride: mocks.setBudgetOverride,
  expireBudgetOverride: mocks.expireBudgetOverride,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { WorkspaceUsage } = await import('../app/(console)/workspaces/[id]/usage.tsx');
const { expireBudgetOverrideAction, setBudgetOverrideAction } =
  await import('../app/(console)/workspaces/[id]/actions.ts');

const WS = '0192d3b0-0000-7000-8000-000000000224';
const STAFF = '0192d3b0-0000-7000-8000-000000000310';
const ADMIN = {
  userId: STAFF,
  email: 'ops@causedeck.test',
  role: 'admin' as const,
  requestId: 'r1',
};
const SUPPORT = { ...ADMIN, role: 'support' as const };
const DAY = 86_400_000;

function override(overrides: Partial<StaffBudgetOverride>): StaffBudgetOverride {
  return {
    id: '0192d3b0-0000-7000-8000-0000000002a1',
    key: 'ai.spend_paise',
    limitValue: 35_000,
    setBy: STAFF,
    reason: 'pilot extension',
    expiresAt: new Date(Date.now() + DAY),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    expiredAt: null,
    expiredBy: null,
    expireReason: null,
    ...overrides,
  };
}

const USAGE: StaffWorkspaceUsage = {
  counters: [
    { key: 'ai.spend_paise', periodStart: new Date('2026-09-30T18:30:00.000Z'), value: 11_250 },
    { key: 'ocr.pages', periodStart: new Date('2026-09-30T18:30:00.000Z'), value: 42 },
  ],
  overrides: [
    override({}),
    override({
      id: '0192d3b0-0000-7000-8000-0000000002a2',
      expiresAt: new Date(Date.now() - DAY),
      reason: 'month end',
    }),
    override({
      id: '0192d3b0-0000-7000-8000-0000000002a3',
      expiresAt: new Date(Date.now() - 1000),
      expiredAt: new Date(Date.now() - 1000),
      expiredBy: STAFF,
      expireReason: 'pilot ended',
    }),
  ],
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

const FUTURE = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 16);

afterEach(cleanup);
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.requireStaff.mockResolvedValue(ADMIN);
  mocks.setBudgetOverride.mockResolvedValue({ id: 'x' });
  mocks.expireBudgetOverride.mockResolvedValue({ id: 'x' });
});

describe('WorkspaceUsage', () => {
  it('lists counters and overrides with their status, and forms for admin staff', () => {
    render(<WorkspaceUsage staff={ADMIN} workspaceId={WS} usage={USAGE} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Rs 112.50 (11250 paise)')).toBeTruthy();
    expect(within(table).getByText('42')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0] as HTMLElement).getByText('active')).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByText('Rs 350.00')).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByText('pilot extension')).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText('expired')).toBeTruthy();
    expect(within(items[2] as HTMLElement).getByText('expired early')).toBeTruthy();
    expect(within(items[2] as HTMLElement).getByText('pilot ended')).toBeTruthy();
    // Only the active override can be expired; the set form is there too.
    expect(screen.getAllByRole('button', { name: 'Expire now' })).toHaveLength(1);
    expect(
      within(items[0] as HTMLElement).getByRole('button', { name: 'Expire now' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set override' })).toBeTruthy();
    expect(screen.getByLabelText('Reason')).toHaveProperty('required', true);
    expect(screen.getByLabelText('Expires at (UTC)')).toHaveProperty('required', true);
  });

  it('is read-only for support staff', () => {
    render(<WorkspaceUsage staff={SUPPORT} workspaceId={WS} usage={USAGE} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows both empty states', () => {
    render(
      <WorkspaceUsage staff={SUPPORT} workspaceId={WS} usage={{ counters: [], overrides: [] }} />,
    );
    expect(screen.getByText('No usage recorded yet.')).toBeTruthy();
    expect(screen.getByText('No budget overrides.')).toBeTruthy();
    cleanup();
    render(<WorkspaceUsage staff={SUPPORT} workspaceId={WS} usage={null} />);
    expect(screen.getByText('No usage recorded yet.')).toBeTruthy();
  });
});

describe('setBudgetOverrideAction', () => {
  const valid = { workspaceId: WS, limitRupees: '1250.5', expiresAt: FUTURE, reason: ' pilot ' };

  it('sets the override in paise for the workspace and staff member, then revalidates', async () => {
    expect(await setBudgetOverrideAction({}, form(valid))).toEqual({ done: true });
    expect(mocks.requireStaff).toHaveBeenCalledWith('workspaces');
    expect(mocks.setBudgetOverride).toHaveBeenCalledWith(
      { db: { runtime: true }, workspaceId: WS },
      {
        limitPaise: 125_050,
        reason: 'pilot',
        expiresAt: new Date(`${FUTURE}Z`),
        staffUserId: STAFF,
        requestId: 'r1',
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/workspaces/${WS}`);
  });

  it('is not found for support staff', async () => {
    mocks.requireStaff.mockResolvedValue(SUPPORT);
    await expect(setBudgetOverrideAction({}, form(valid))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.setBudgetOverride).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank reason', { reason: '   ' }],
    ['no expiry', { expiresAt: '' }],
    ['a past expiry', { expiresAt: '2020-01-01T00:00' }],
    ['a negative limit', { limitRupees: '-5' }],
    ['fractional paise', { limitRupees: '1.234' }],
    ['a malformed workspace id', { workspaceId: 'not-a-uuid' }],
  ])('refuses %s without writing', async (_label, change) => {
    const state = await setBudgetOverrideAction({}, form({ ...valid, ...change }));
    expect(state.error).toEqual(expect.any(String));
    expect(mocks.setBudgetOverride).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('expireBudgetOverrideAction', () => {
  const valid = {
    workspaceId: WS,
    overrideId: '0192d3b0-0000-7000-8000-0000000002a1',
    reason: 'pilot ended',
  };

  it('expires the override for the workspace and staff member, then revalidates', async () => {
    expect(await expireBudgetOverrideAction({}, form(valid))).toEqual({ done: true });
    expect(mocks.expireBudgetOverride).toHaveBeenCalledWith(
      { db: { runtime: true }, workspaceId: WS },
      { overrideId: valid.overrideId, reason: 'pilot ended', staffUserId: STAFF, requestId: 'r1' },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/workspaces/${WS}`);
  });

  it('is not found for support staff', async () => {
    mocks.requireStaff.mockResolvedValue(SUPPORT);
    await expect(expireBudgetOverrideAction({}, form(valid))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.expireBudgetOverride).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank reason', { reason: '' }],
    ['a malformed override id', { overrideId: 'nope' }],
  ])('refuses %s without writing', async (_label, change) => {
    const state = await expireBudgetOverrideAction({}, form({ ...valid, ...change }));
    expect(state.error).toEqual(expect.any(String));
    expect(mocks.expireBudgetOverride).not.toHaveBeenCalled();
  });

  it('reports an override that is no longer active', async () => {
    mocks.expireBudgetOverride.mockRejectedValue(new TypeError('no active override'));
    expect(await expireBudgetOverrideAction({}, form(valid))).toEqual({
      error: 'This override is no longer active.',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
