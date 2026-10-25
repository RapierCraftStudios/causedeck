// @vitest-environment jsdom
// `/account` client components (#289): the passkey list, the session table, the 3-step two-factor
// dialog and the profile form. Empty states use the design-spec copy, the session list is a
// labelled table, backup codes have Copy/Download, focus follows the dialog steps, offline turns
// the controls read-only, and every string resolves in en, ta and kn.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PasskeyView } from '../components/settings/passkey-list.tsx';
import type { SessionView } from '../components/settings/session-list.tsx';

import { catalogs, type TestLocale } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@causedeck/ui/sonner', () => ({ toast }));
vi.mock('../app/(app)/account/actions.ts', () => ({ setLocaleAction: vi.fn() }));

const { PasskeyList } = await import('../components/settings/passkey-list.tsx');
const { SessionList, describeUserAgent } = await import('../components/settings/session-list.tsx');
const { TwoFactorSetup, TwoFactorSetupDialog } =
  await import('../components/settings/two-factor-setup-dialog.tsx');
const { AccountProfileForm } = await import('../app/(app)/account/profile/profile-form.tsx');

const en = catalogs.en.settings.account;
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const missing: string[] = [];
const withIntl = (ui: ReactNode, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={catalogs[locale]}
      timeZone="Asia/Kolkata"
      onError={(error: IntlError) => {
        missing.push(error.message);
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

afterEach(() => {
  cleanup();
  setOnline(true);
  vi.clearAllMocks();
  missing.length = 0;
});

const SESSIONS: SessionView[] = [
  {
    id: 'session-current',
    userAgent: CHROME_WINDOWS,
    ipAddress: '203.0.113.7',
    createdAt: '2026-10-19T08:00:00.000Z',
    current: true,
  },
  {
    id: 'session-phone',
    userAgent: SAFARI_IPHONE,
    ipAddress: '198.51.100.4',
    createdAt: '2026-10-18T08:00:00.000Z',
    current: false,
  },
];

describe('PasskeyList', () => {
  it('shows the empty-state copy when there are no passkeys', () => {
    withIntl(<PasskeyList passkeys={[]} deletePasskey={vi.fn()} />);
    expect(screen.getByText(en.passkeys.empty)).toBeTruthy();
    expect(
      en.passkeys.empty ===
        'No passkeys yet. Add one to sign in with your fingerprint or screen lock.',
    ).toBe(true);
    expect(screen.getByRole('button', { name: en.passkeys.add })).toBeTruthy();
  });

  it('adds a passkey through the browser ceremony and refreshes', async () => {
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: () => {} });
    const addPasskey = vi.fn(() => Promise.resolve('added' as const));
    withIntl(<PasskeyList passkeys={[]} deletePasskey={vi.fn()} addPasskey={addPasskey} />);
    fireEvent.click(screen.getByRole('button', { name: en.passkeys.add }));
    await waitFor(() => {
      expect(router.refresh).toHaveBeenCalled();
    });
    expect(toast).toHaveBeenCalledWith(en.passkeys.toast.added);
    Reflect.deleteProperty(window, 'PublicKeyCredential');
  });

  it('removes a passkey after confirmation', async () => {
    const passkeys: PasskeyView[] = [
      { id: 'pk-1', name: 'Laptop', createdAt: '2026-10-01T00:00:00.000Z' },
    ];
    const deletePasskey = vi.fn((input: { id: string }) => ok(input));
    withIntl(<PasskeyList passkeys={passkeys} deletePasskey={deletePasskey} />);
    const list = screen.getByRole('list', { name: en.passkeys.listLabel });
    fireEvent.click(within(list).getByRole('button', { name: 'Remove Laptop' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.passkeys.removeConfirm }));
    await waitFor(() => {
      expect(deletePasskey).toHaveBeenCalledWith({ id: 'pk-1' });
    });
    expect(toast).toHaveBeenCalledWith(en.passkeys.toast.removed);
  });

  it('says it is not your account on FORBIDDEN', async () => {
    const deletePasskey = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'FORBIDDEN' as const, message: '' } }),
    );
    withIntl(
      <PasskeyList
        passkeys={[{ id: 'pk-1', name: null, createdAt: '2026-10-01T00:00:00.000Z' }]}
        deletePasskey={deletePasskey}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Passkey' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.passkeys.removeConfirm }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.forbidden);
    });
  });

  it('is read-only offline', () => {
    setOnline(false);
    withIntl(
      <PasskeyList
        passkeys={[{ id: 'pk-1', name: 'Laptop', createdAt: '2026-10-01T00:00:00.000Z' }]}
        deletePasskey={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: en.passkeys.add }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Remove Laptop' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});

describe('SessionList', () => {
  it('describes devices from the user agent', () => {
    expect(describeUserAgent(CHROME_WINDOWS)).toEqual({ browser: 'Chrome', os: 'Windows' });
    expect(describeUserAgent(SAFARI_IPHONE)).toEqual({ browser: 'Safari', os: 'iOS' });
    expect(describeUserAgent('curl/8.0')).toBeNull();
    expect(describeUserAgent(null)).toBeNull();
  });

  it('is a labelled table with the current session marked and no Revoke on it', () => {
    withIntl(<SessionList sessions={SESSIONS} revokeSession={vi.fn()} />);
    const table = screen.getByRole('table', { name: en.sessions.tableCaption });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText(en.sessions.current)).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByRole('button')).toBeNull();
    expect(
      within(rows[2] as HTMLElement).getByRole('button', {
        name: 'Revoke the session on Safari on iOS',
      }),
    ).toBeTruthy();
    expect(screen.queryByText(en.sessions.empty)).toBeNull();
  });

  it('says `No other active sessions.` when only this device is signed in', () => {
    withIntl(<SessionList sessions={SESSIONS.slice(0, 1)} revokeSession={vi.fn()} />);
    expect(screen.getByText('No other active sessions.')).toBeTruthy();
    expect(screen.getByRole('table', { name: en.sessions.tableCaption })).toBeTruthy();
  });

  it('revokes another session by id after confirmation and drops its row', async () => {
    const revokeSession = vi.fn((input: { sessionId: string }) => ok(input));
    withIntl(<SessionList sessions={SESSIONS} revokeSession={revokeSession} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the session on Safari on iOS' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.sessions.revokeConfirm }));
    await waitFor(() => {
      expect(revokeSession).toHaveBeenCalledWith({ sessionId: 'session-phone' });
    });
    await waitFor(() => {
      expect(screen.getByText(en.sessions.empty)).toBeTruthy();
    });
    expect(toast).toHaveBeenCalledWith(en.sessions.toast.revoked);
  });

  it('is read-only offline', () => {
    setOnline(false);
    withIntl(<SessionList sessions={SESSIONS} revokeSession={vi.fn()} />);
    expect(
      screen
        .getByRole('button', { name: 'Revoke the session on Safari on iOS' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });
});

const SETUP = {
  qr: `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')}`,
  secret: 'JBSWY3DPEHPK3PXP',
  backupCodes: ['aaaa-1111', 'bbbb-2222'],
};

describe('TwoFactorSetupDialog', () => {
  function renderDialog(verify = vi.fn(() => ok({ enabled: true as const }))) {
    const enableTwoFactor = vi.fn(() => ok(SETUP));
    const onEnabled = vi.fn();
    withIntl(
      <TwoFactorSetupDialog
        open
        onOpenChange={vi.fn()}
        onEnabled={onEnabled}
        enableTwoFactor={enableTwoFactor}
        verifyTwoFactor={verify}
      />,
    );
    return { enableTwoFactor, onEnabled, verify };
  }

  it('walks scan → verify → backup codes with focus on each step', async () => {
    const { enableTwoFactor, onEnabled, verify } = renderDialog();
    const dialog = await screen.findByRole('dialog', { name: en.twoFactor.dialog.title });
    expect(enableTwoFactor).toHaveBeenCalledWith({});

    // Step 1: the QR code on a white surface, and the key to type.
    const qr = await within(dialog).findByRole('img', { name: en.twoFactor.dialog.qrAlt });
    expect(qr.closest('[data-slot="two-factor-qr"]')?.className).toContain('bg-[#ffffff]');
    expect(within(dialog).getByText(SETUP.secret)).toBeTruthy();
    expect(within(dialog).getByText('Step 1 of 3')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(en.twoFactor.dialog.scanTitle);
    });

    // Step 2: the code field takes focus; a short code is rejected before any call.
    fireEvent.click(within(dialog).getByRole('button', { name: en.twoFactor.dialog.next }));
    const code = within(dialog).getByRole('textbox', { name: en.twoFactor.dialog.code });
    await waitFor(() => {
      expect(document.activeElement).toBe(code);
    });
    fireEvent.change(code, { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.twoFactor.dialog.verify }));
    expect(await within(dialog).findByText(en.twoFactor.dialog.errors.code)).toBeTruthy();
    expect(verify).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.twoFactor.dialog.verify }));

    // Step 3: backup codes, selectable, with Copy and Download.
    const codes = await within(dialog).findByRole('list', {
      name: en.twoFactor.dialog.codesLabel,
    });
    expect(verify).toHaveBeenCalledWith({ code: '123456' });
    expect(onEnabled).toHaveBeenCalledTimes(1);
    expect(
      within(codes)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(SETUP.backupCodes);
    expect(codes.className).toContain('select-all');
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Download' })).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(en.twoFactor.dialog.codesTitle);
    });
  });

  it('copies and downloads the backup codes', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const createObjectURL = vi.fn(() => 'blob:codes');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('img');
    fireEvent.click(within(dialog).getByRole('button', { name: en.twoFactor.dialog.next }));
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.twoFactor.dialog.verify }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('aaaa-1111\nbbbb-2222');
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('a wrong code says so and stays on the verify step', async () => {
    renderDialog(
      vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'VALIDATION' as const, message: '' },
        }),
      ) as never,
    );
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('img');
    fireEvent.click(within(dialog).getByRole('button', { name: en.twoFactor.dialog.next }));
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.twoFactor.dialog.verify }));
    expect(await within(dialog).findByText(en.twoFactor.dialog.errors.wrongCode)).toBeTruthy();
    expect(dialog.getAttribute('data-step')).toBe('verify');
  });
});

describe('TwoFactorSetup', () => {
  it('shows On without Set up when enabled, Off with Set up otherwise', () => {
    const { unmount } = withIntl(
      <TwoFactorSetup enabled enableTwoFactor={vi.fn()} verifyTwoFactor={vi.fn()} />,
    );
    expect(screen.getByText(en.twoFactor.on)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.twoFactor.setUp })).toBeNull();
    unmount();
    withIntl(
      <TwoFactorSetup enabled={false} enableTwoFactor={vi.fn()} verifyTwoFactor={vi.fn()} />,
    );
    expect(screen.getByText(en.twoFactor.off)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.twoFactor.setUp })).toBeTruthy();
  });
});

describe('AccountProfileForm', () => {
  it('saves a new name and shows initials', async () => {
    const save = vi.fn((input: { name: string }) => ok(input));
    withIntl(<AccountProfileForm name="Asha Rao" email="asha@example.in" save={save} />);
    expect(screen.getByRole('img', { name: 'Asha Rao' }).textContent).toBe('AR');
    expect(screen.getByText('asha@example.in')).toBeTruthy();
    const saveButton = screen.getByRole('button', { name: en.profile.save });
    expect(saveButton.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: en.profile.name }), {
      target: { value: 'Asha R. Iyer' },
    });
    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ name: 'Asha R. Iyer' });
    });
    expect(toast).toHaveBeenCalledWith(en.profile.toast.saved);
  });

  it('rejects an empty name before saving', async () => {
    const save = vi.fn();
    withIntl(<AccountProfileForm name="Asha Rao" email="asha@example.in" save={save} />);
    // Whitespace only: a change from the saved name, but not a valid one.
    fireEvent.change(screen.getByRole('textbox', { name: en.profile.name }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.profile.save }));
    expect(await screen.findByText(en.profile.errors.name)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it('is read-only offline', () => {
    setOnline(false);
    withIntl(<AccountProfileForm name="Asha Rao" email="asha@example.in" save={vi.fn()} />);
    expect(screen.getByRole('button', { name: en.profile.save }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});

describe('localised', () => {
  it.each(['en', 'ta', 'kn'] as const)('renders every account component in %s', (locale) => {
    withIntl(
      <>
        <AccountProfileForm name="Asha Rao" email="asha@example.in" save={vi.fn()} />
        <PasskeyList passkeys={[]} deletePasskey={vi.fn()} />
        <SessionList sessions={SESSIONS} revokeSession={vi.fn()} />
        <TwoFactorSetup enabled={false} enableTwoFactor={vi.fn()} verifyTwoFactor={vi.fn()} />
      </>,
      locale,
    );
    expect(missing).toEqual([]);
    expect(screen.getByText(catalogs[locale].settings.account.passkeys.empty)).toBeTruthy();
    if (locale !== 'en') {
      expect(catalogs[locale].settings.account.passkeys.empty).not.toBe(en.passkeys.empty);
    }
  });
});
