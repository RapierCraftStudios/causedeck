// @vitest-environment jsdom
// The central policy wired into the web app (#234): the shell's `can()` and `MATRIX` are the
// server's own module instances (no duplicated rules), `<Can>`/`useCan` hide or disable by that
// matrix, and `safeAction`/`guard` turn policy denials into FORBIDDEN (NOT_FOUND for a concealed
// read) without leaking the action or reason.
import * as policy from '@causedeck/auth/policy';
import { PolicyProvider, useCan } from '@causedeck/auth/react';
import type { AuthSession } from '@causedeck/auth/session';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Can, deniedHintKey } from '../components/can.tsx';
import type { AppSession } from '../lib/auth.ts';
import { guard, guardResponse, type AccessDenial } from '../lib/guard.ts';
import { safeAction } from '../lib/safe-action.ts';
import * as workspaceContext from '../lib/workspace-context.ts';
import { workspaceAction } from '../lib/workspace-action.ts';

import { catalogs } from './helpers/intl.ts';

vi.mock('../lib/auth.ts', () => ({ getSession: () => Promise.resolve(null) }));

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const session = { session: {}, user: { id: USER, name: 'M', email: 'm@x.test' } } as AppSession;

afterEach(() => {
  cleanup();
});

describe('one policy module for web and server', () => {
  it('re-exports the server matrix and can() instances, not copies', () => {
    expect(workspaceContext.MATRIX).toBe(policy.MATRIX);
    expect(workspaceContext.can).toBe(policy.roleCan);
  });

  it('gates the shell permissions exactly as the old role table did', () => {
    const legacy: Record<policy.Role, readonly string[]> = {
      owner: ['billing.read', 'invoices.read', 'limitation.read', 'insights.read', 'settings.read'],
      advocate: ['limitation.read', 'insights.read', 'settings.read'],
      junior: ['limitation.read', 'insights.read', 'settings.read'],
      clerk: ['settings.read'],
      viewer: [],
    };
    const shell = [
      'billing.read',
      'invoices.read',
      'limitation.read',
      'insights.read',
      'settings.read',
    ] as const;
    for (const role of policy.ROLES) {
      for (const action of shell) {
        expect(workspaceContext.can(role, action), `${role} ${action}`).toBe(
          legacy[role].includes(action),
        );
      }
    }
  });
});

function renderAs(role: policy.Role, ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      <PolicyProvider actor={{ userId: USER, workspaceId: WS, role }}>{ui}</PolicyProvider>
    </NextIntlClientProvider>,
  );
}

describe('<Can> and useCan()', () => {
  it('hides denied UI and shows allowed UI', () => {
    renderAs(
      'advocate',
      <>
        <Can action="member.role">
          <button type="button">Change role</button>
        </Can>
        <Can action="member.invite">
          <button type="button">Invite member</button>
        </Can>
      </>,
    );
    expect(screen.queryByRole('button', { name: 'Change role' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeTruthy();
  });

  it('disables denied UI with the "Only owners can do this" tooltip', () => {
    renderAs(
      'advocate',
      <Can action="member.role" mode="disable">
        <button type="button">Change role</button>
      </Can>,
    );
    const button = screen.getByRole('button', { name: 'Change role' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.closest('[title]')?.getAttribute('title')).toBe('Only owners can do this');
  });

  it('leaves the control enabled for an owner', () => {
    renderAs(
      'owner',
      <Can action="member.role" mode="disable">
        <button type="button">Change role</button>
      </Can>,
    );
    expect(screen.getByRole('button', { name: 'Change role' })).toHaveProperty('disabled', false);
  });

  it('agrees with the server can() for every (role, action) pair', () => {
    const seen: string[] = [];
    function Probe({ action }: { action: policy.Action }) {
      seen.push(`${action}:${String(useCan(action).allow)}`);
      return null;
    }
    for (const role of policy.ROLES) {
      seen.length = 0;
      const { unmount } = renderAs(
        role,
        policy.ALL_ACTIONS.map((action) => <Probe key={action} action={action} />),
      );
      expect(seen).toEqual(
        policy.ALL_ACTIONS.map((a) => `${a}:${String(policy.roleCan(role, a))}`),
      );
      unmount();
    }
  });

  it('denies everything without a provider', () => {
    function Probe() {
      return <span>{String(useCan('matter.read').allow)}</span>;
    }
    render(<Probe />);
    expect(screen.getByText('false')).toBeTruthy();
  });

  it('names who may act in the tooltip', () => {
    expect(deniedHintKey('member.role')).toBe('ownersOnly');
    expect(deniedHintKey('audit.read')).toBe('ownersAndAdvocates');
    expect(deniedHintKey('matter.write')).toBe('roleTooLow');
  });
});

const quiet = { logger: { warn: () => undefined } };
const getSession = () => Promise.resolve(session as AuthSession);

describe('safeAction maps policy denials', () => {
  it('returns FORBIDDEN for a denied action', async () => {
    const run = safeAction(
      z.object({}),
      () => {
        policy.assertCan(
          { userId: USER, workspaceId: WS, role: 'advocate' },
          'member.role',
          undefined,
          quiet,
        );
        return Promise.resolve('never');
      },
      { getSession },
    );
    expect(await run({})).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'You do not have access to this.' },
    });
  });

  it('returns NOT_FOUND for a read of a restricted resource', async () => {
    const run = safeAction(
      z.object({}),
      () => {
        policy.assertCan(
          { userId: USER, workspaceId: WS, role: 'advocate' },
          'matter.read',
          { kind: 'matter', workspaceId: WS, matterId: 'm1', restricted: { allowUserIds: [] } },
          quiet,
        );
        return Promise.resolve('never');
      },
      { getSession },
    );
    expect(await run({})).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'We could not find this.' },
    });
  });
});

describe('guard and workspaceAction', () => {
  const memberRole = (role: string | null) => () => Promise.resolve(role);

  it('authorizes the action after membership', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      guard(
        { workspaceId: WS, action: 'member.role', session },
        { memberRole: memberRole('owner') },
      ),
    ).resolves.toMatchObject({
      role: 'owner',
      actor: { userId: USER, workspaceId: WS, role: 'owner' },
    });
    await expect(
      guard(
        { workspaceId: WS, action: 'member.role', session },
        { memberRole: memberRole('advocate') },
      ),
    ).rejects.toSatisfy(policy.isForbiddenError);
    await expect(
      guard({ workspaceId: WS, session }, { memberRole: memberRole(null) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('maps guard failures to route-handler responses', () => {
    expect(guardResponse(new policy.ForbiddenError('member.role', 'ROLE_DENIED'))?.status).toBe(
      403,
    );
    expect(
      guardResponse(new policy.ForbiddenError('matter.read', 'RESTRICTED_MATTER'))?.status,
    ).toBe(404);
    expect(guardResponse(Object.assign(new Error('x'), { code: 'UNAUTHENTICATED' }))?.status).toBe(
      401,
    );
    expect(guardResponse(new Error('boom'))).toBeNull();
  });

  it('workspaceAction with an action rejects a denied member before the handler runs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = vi.fn(() => Promise.resolve('ran'));
    const run = workspaceAction(z.object({ workspaceId: z.uuid() }), handler, {
      action: 'member.role',
      requireSession: () => Promise.resolve(session),
      memberRole: memberRole('advocate'),
      runInWorkspace: (_scope, fn) => fn({} as never),
    });
    expect(await run({ workspaceId: WS })).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'You do not have access to this.' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('records access.denied for a non-member and a policy denial (#228)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recordDenied = vi.fn(() => Promise.resolve());
    await expect(
      guard({ workspaceId: WS, session }, { memberRole: memberRole(null), recordDenied }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      guard(
        { workspaceId: WS, action: 'member.role', session },
        { memberRole: memberRole('advocate'), recordDenied },
      ),
    ).rejects.toSatisfy(policy.isForbiddenError);
    await guard(
      { workspaceId: WS, action: 'member.role', session },
      { memberRole: memberRole('owner'), recordDenied },
    );
    expect(recordDenied.mock.calls).toEqual([
      [{ workspaceId: WS, member: false, actorUserId: USER, action: undefined }],
      [
        {
          workspaceId: WS,
          member: true,
          actorUserId: USER,
          action: 'member.role',
          reason: expect.any(String) as string,
        },
      ],
    ]);
  });

  it('workspaceAction records a domain FORBIDDEN once, after the workspace transaction', async () => {
    const recordDenied = vi.fn<(denial: AccessDenial) => Promise<void>>(() => Promise.resolve());
    const order: string[] = [];
    const run = workspaceAction(
      z.object({ workspaceId: z.uuid() }),
      () => {
        throw Object.assign(new Error('Only owners can do that'), {
          name: 'WorkspaceError',
          code: 'FORBIDDEN',
        });
      },
      {
        requireSession: () => Promise.resolve(session),
        memberRole: memberRole('advocate'),
        recordDenied: (denial) => {
          order.push('recorded');
          return recordDenied(denial);
        },
        runInWorkspace: async (_scope, fn) => {
          try {
            return await fn({} as never);
          } finally {
            order.push('rolled back');
          }
        },
      },
    );
    expect(await run({ workspaceId: WS })).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Only owners can do that' },
    });
    expect(order).toEqual(['rolled back', 'recorded']);
    expect(recordDenied).toHaveBeenCalledWith({
      workspaceId: WS,
      member: true,
      actorUserId: USER,
      action: undefined,
      reason: 'FORBIDDEN',
    });
  });
});
