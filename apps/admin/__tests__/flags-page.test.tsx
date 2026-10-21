// @vitest-environment jsdom
// The flags page rows (#311): a kill-switched flag says `Forced off by environment` and cannot be
// toggled, every change restates old → new before it applies, a legal-gated enable asks for the
// note, the acknowledgement and a TOTP code before it can be sent, and Approve is shown only to an
// admin, never on their own request.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FlagRowView, PendingRequestView } from '../lib/flags.ts';

vi.mock('../app/(console)/flags/actions.ts', () => ({
  setFlagAction: vi.fn(() => Promise.resolve({})),
  requestLegalEnableAction: vi.fn(() => Promise.resolve({})),
  approveLegalEnableAction: vi.fn(() => Promise.resolve({})),
  rejectLegalEnableAction: vi.fn(() => Promise.resolve({})),
}));

const { diffSummary, FlagRow, FORCED_OFF, PendingRequestRow } =
  await import('../app/(console)/flags/flag-row.tsx');

afterEach(cleanup);

// Radix's checkbox measures itself; jsdom has no ResizeObserver.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

function flag(overrides: Partial<FlagRowView> = {}): FlagRowView {
  return {
    key: 'pwa.offline',
    description: 'Offline outbox and 7-day offline cache.',
    legalGated: false,
    killSwitchEnv: 'KILL_PWA_OFFLINE',
    killed: false,
    global: null,
    override: null,
    effective: false,
    ...overrides,
  };
}

function inTable(children: ReactNode) {
  return render(
    <table>
      <tbody>{children}</tbody>
    </table>,
  );
}

describe('FlagRow', () => {
  it('shows a kill-switched flag as forced off, with its variable, and disables the toggle', () => {
    inTable(
      <FlagRow
        flag={flag({
          key: 'invoices.enabled',
          legalGated: true,
          killSwitchEnv: 'KILL_INVOICES_ENABLED',
          killed: true,
          global: true,
        })}
        totpRequired
      />,
    );
    expect(FORCED_OFF).toBe('Forced off by environment');
    expect(screen.getByText('Forced off by environment')).toBeTruthy();
    expect(screen.getByText('KILL_INVOICES_ENABLED')).toBeTruthy();
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true);
  });

  it('restates old → new before applying a change', () => {
    expect(diffSummary(flag({ global: true }), undefined, false)).toBe(
      'pwa.offline · Global · On → Off',
    );
    expect(diffSummary(flag(), 'ws-1', true)).toBe('pwa.offline · Workspace ws-1 · Inherit → On');

    inTable(<FlagRow flag={flag()} totpRequired />);
    fireEvent.click(screen.getByRole('switch', { name: 'pwa.offline: turn on' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('flag-diff').textContent).toBe(
      'pwa.offline · Global · Off (default) → On',
    );
    const apply = within(dialog).getByRole('button', { name: 'Apply' });
    expect(apply).toHaveProperty('disabled', false);
  });

  it('asks for the note, the acknowledgement and a TOTP code to enable a legal-gated flag', () => {
    inTable(
      <FlagRow
        flag={flag({ key: 'limitation.enabled', legalGated: true, killSwitchEnv: 'KILL_X' })}
        totpRequired
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/second admin before it takes effect/)).toBeTruthy();
    const send = within(dialog).getByRole('button', { name: 'Send for approval' });
    expect(send).toHaveProperty('disabled', true);

    fireEvent.change(within(dialog).getByLabelText('Legal note'), {
      target: { value: 'Counsel opinion #120' },
    });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(send).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByLabelText('Authenticator code'), {
      target: { value: '123456' },
    });
    expect(send).toHaveProperty('disabled', false);
    expect(dialog.querySelector<HTMLInputElement>('input[name="acknowledged"]')?.value).toBe('on');
  });

  it('turns a legal-gated flag off without the legal fields', () => {
    inTable(
      <FlagRow
        flag={flag({ key: 'limitation.enabled', legalGated: true, global: true })}
        totpRequired
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Legal note')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', false);
  });
});

describe('PendingRequestRow', () => {
  const request: PendingRequestView = {
    id: '3e9f4d85-1d6b-4a0c-8f4b-8c5d0e6f7081',
    key: 'invoices.enabled',
    workspaceId: null,
    legalAckNote: 'Counsel opinion #120',
    requestedAt: '2026-10-20T10:00:00.000Z',
    own: false,
  };

  it('lets an admin approve or reject another staff member’s request', () => {
    inTable(<PendingRequestRow request={request} admin totpRequired />);
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('approve-diff').textContent).toBe(
      'invoices.enabled · Global · Off → On',
    );
    expect(within(dialog).getByLabelText('Authenticator code')).toBeTruthy();
  });

  it('hides Approve for ops and on the viewer’s own request', () => {
    inTable(<PendingRequestRow request={request} admin={false} totpRequired />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Waiting for an admin')).toBeTruthy();
    cleanup();

    inTable(<PendingRequestRow request={{ ...request, own: true }} admin totpRequired />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });
});
