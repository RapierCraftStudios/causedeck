// Owner 2FA policy (#290): owners must turn on 2FA within 7 days of the owner role grant; after
// that, destructive actions (delete, export, billing) are refused by `guard` until they do.
import { describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';
import { guard, guardResponse, type AccessDenial } from '../lib/guard.ts';
import {
  assertOwnerTwoFactor,
  DESTRUCTIVE_ACTIONS,
  graceEndsAt,
  isDestructive,
  OWNER_2FA_GRACE_DAYS,
  ownerTwoFactorState,
  ownerTwoFactorStateFor,
  TWO_FACTOR_REQUIRED,
} from '../lib/require-2fa-for-owners.ts';
import { ActionError } from '../lib/safe-action.ts';

const DAY = 24 * 60 * 60 * 1000;
const GRANTED = new Date('2026-10-01T00:00:00Z');
const at = (days: number, ms = 0) => new Date(GRANTED.getTime() + days * DAY + ms);
const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-0000000000aa';

const session = (twoFactorEnabled?: boolean): AppSession =>
  ({
    session: {},
    user: { id: USER, email: 'owner@example.test', name: 'Owner', twoFactorEnabled },
  }) as unknown as AppSession;

describe('ownerTwoFactorState', () => {
  it('gives owners a 7-day grace from the role grant, then requires 2FA', () => {
    expect(OWNER_2FA_GRACE_DAYS).toBe(7);
    expect(graceEndsAt(GRANTED)).toEqual(at(7));
    const owner = { role: 'owner', roleGrantedAt: GRANTED, twoFactorEnabled: false };
    expect(ownerTwoFactorState({ ...owner, now: GRANTED })).toBe('grace');
    expect(ownerTwoFactorState({ ...owner, now: at(7, -1) })).toBe('grace');
    expect(ownerTwoFactorState({ ...owner, now: at(7) })).toBe('required');
    expect(ownerTwoFactorState({ ...owner, now: at(30) })).toBe('required');
  });

  it('never applies to owners with 2FA or to other roles', () => {
    expect(
      ownerTwoFactorState({
        role: 'owner',
        roleGrantedAt: GRANTED,
        twoFactorEnabled: true,
        now: at(30),
      }),
    ).toBe('enabled');
    for (const role of ['advocate', 'junior', 'clerk', 'viewer', null]) {
      expect(
        ownerTwoFactorState({ role, roleGrantedAt: GRANTED, twoFactorEnabled: false, now: at(30) }),
      ).toBe('not-owner');
    }
  });

  it('treats an owner with no known grant time as past the grace (fail closed)', () => {
    expect(
      ownerTwoFactorState({ role: 'owner', roleGrantedAt: null, twoFactorEnabled: false }),
    ).toBe('required');
  });

  it('lists delete, export and billing as destructive, and nothing else', () => {
    expect([...DESTRUCTIVE_ACTIONS]).toEqual(['workspace.delete', 'export.run', 'billing.manage']);
    expect(isDestructive('billing.manage')).toBe(true);
    expect(isDestructive('member.role')).toBe(false);
    expect(isDestructive('billing.read')).toBe(false);
    expect(isDestructive(undefined)).toBe(false);
  });
});

describe('ownerTwoFactorStateFor', () => {
  it('reads 2FA from the session and the grant time only for owners without 2FA', async () => {
    const ownerGrace = vi.fn(() => Promise.resolve({ role: 'owner', roleGrantedAt: GRANTED }));
    expect(
      await ownerTwoFactorStateFor(session(true), WORKSPACE, { role: 'owner', ownerGrace }),
    ).toBe('enabled');
    expect(
      await ownerTwoFactorStateFor(session(false), WORKSPACE, { role: 'advocate', ownerGrace }),
    ).toBe('not-owner');
    expect(ownerGrace).not.toHaveBeenCalled();
    expect(
      await ownerTwoFactorStateFor(session(false), WORKSPACE, { ownerGrace, now: at(8) }),
    ).toBe('required');
    expect(ownerGrace).toHaveBeenCalledWith(USER, WORKSPACE);
  });

  it('is not-owner for a non-member', async () => {
    expect(
      await ownerTwoFactorStateFor(session(), WORKSPACE, {
        ownerGrace: () => Promise.resolve(null),
      }),
    ).toBe('not-owner');
  });

  it('assertOwnerTwoFactor throws FORBIDDEN only after the grace', async () => {
    const ownerGrace = () => Promise.resolve({ role: 'owner', roleGrantedAt: GRANTED });
    await expect(
      assertOwnerTwoFactor(session(), WORKSPACE, { ownerGrace, now: at(3) }),
    ).resolves.toBeUndefined();
    const error = await assertOwnerTwoFactor(session(), WORKSPACE, {
      ownerGrace,
      now: at(8),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe('FORBIDDEN');
  });
});

describe('guard and the owner 2FA policy', () => {
  const setup = (opts: { role?: string; twoFactor?: boolean; grantedDaysAgo?: number } = {}) => {
    const denials: AccessDenial[] = [];
    const ownerGrace = vi.fn(() =>
      Promise.resolve({
        role: opts.role ?? 'owner',
        roleGrantedAt: new Date(Date.now() - (opts.grantedDaysAgo ?? 30) * DAY),
      }),
    );
    const deps = {
      memberRole: () => Promise.resolve(opts.role ?? 'owner'),
      recordDenied: (denial: AccessDenial) => {
        denials.push(denial);
        return Promise.resolve();
      },
      ownerGrace,
    };
    return { deps, denials, ownerGrace, s: session(opts.twoFactor ?? false) };
  };

  it.each(DESTRUCTIVE_ACTIONS)(
    'refuses %s to an owner past the grace and records it',
    async (action) => {
      const { deps, denials, s } = setup();
      const error = await guard({ workspaceId: WORKSPACE, action, session: s }, deps).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ActionError);
      expect((error as ActionError).code).toBe('FORBIDDEN');
      expect(guardResponse(error)?.status).toBe(403);
      expect(denials).toEqual([
        {
          workspaceId: WORKSPACE,
          member: true,
          actorUserId: USER,
          action,
          reason: TWO_FACTOR_REQUIRED,
        },
      ]);
    },
  );

  it('allows destructive actions during the grace and once 2FA is on', async () => {
    const inGrace = setup({ grantedDaysAgo: 2 });
    await expect(
      guard({ workspaceId: WORKSPACE, action: 'billing.manage', session: inGrace.s }, inGrace.deps),
    ).resolves.toMatchObject({ role: 'owner' });
    const enabled = setup({ twoFactor: true });
    await expect(
      guard({ workspaceId: WORKSPACE, action: 'billing.manage', session: enabled.s }, enabled.deps),
    ).resolves.toMatchObject({ role: 'owner' });
    expect(enabled.ownerGrace).not.toHaveBeenCalled();
    expect([...inGrace.denials, ...enabled.denials]).toEqual([]);
  });

  it('leaves non-destructive actions alone, including ownership transfer', async () => {
    const { deps, denials, ownerGrace, s } = setup();
    for (const action of ['member.role', 'billing.read', 'workspace.manage'] as const) {
      await expect(
        guard({ workspaceId: WORKSPACE, action, session: s }, deps),
      ).resolves.toBeTruthy();
    }
    await expect(guard({ workspaceId: WORKSPACE, session: s }, deps)).resolves.toBeTruthy();
    expect(ownerGrace).not.toHaveBeenCalled();
    expect(denials).toEqual([]);
  });

  it('applies to `destructive: true` requests without an action (export downloads)', async () => {
    const { deps, s } = setup();
    await expect(
      guard({ workspaceId: WORKSPACE, destructive: true, session: s }, deps),
    ).rejects.toBeInstanceOf(ActionError);
    const advocate = setup({ role: 'advocate' });
    await expect(
      guard({ workspaceId: WORKSPACE, destructive: true, session: advocate.s }, advocate.deps),
    ).resolves.toMatchObject({ role: 'advocate' });
    expect(advocate.ownerGrace).not.toHaveBeenCalled();
  });

  it('does not record a 2FA denial when the grace lookup itself fails', async () => {
    const { deps, denials, s } = setup();
    const failing = { ...deps, ownerGrace: () => Promise.reject(new Error('db down')) };
    await expect(
      guard({ workspaceId: WORKSPACE, action: 'export.run', session: s }, failing),
    ).rejects.toThrow('db down');
    expect(denials).toEqual([]);
  });
});
