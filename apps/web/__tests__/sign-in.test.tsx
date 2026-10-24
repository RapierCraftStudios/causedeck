// @vitest-environment jsdom
// Sign-in UI (#153): flag-gated Google, passkey support, magic link and check-email, and the
// error, expired, offline and access_denied copy. Browser flows live in #16 (Playwright).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';

const state = vi.hoisted(() => ({
  googleEnabled: false,
  session: null as { user: { id: string } } | null,
}));

const client = vi.hoisted(() => ({
  magicLink: vi.fn(),
  social: vi.fn(),
  passkey: vi.fn(),
  sso: vi.fn(),
}));

vi.mock('../lib/auth-client.ts', () => ({
  authClient: {
    signIn: { magicLink: client.magicLink, social: client.social,
      passkey: client.passkey,
      sso: client.sso,
    },
  },
}));
vi.mock('../lib/auth.ts', () => ({ getSession: () => Promise.resolve(state.session) }));
vi.mock('../lib/env.ts', () => ({
  serverEnv: () => ({ AUTH_GOOGLE_ENABLED: state.googleEnabled }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { SignInForm } = await import('../app/(public)/sign-in/sign-in-form.tsx');
const { CheckEmail, RESEND_AFTER_SECONDS } =
  await import('../app/(public)/sign-in/check-email.tsx');
const { default: SignInPage } = await import('../app/(public)/sign-in/page.tsx');

const en = catalogs.en.auth;

function renderEn(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const formProps = {
  googleEnabled: false,
  next: '/w/anything',
  initialError: null,
  expiresInMinutes: 10,
} as const;

async function renderPage(searchParams: Record<string, string> = {}) {
  const page = await SignInPage({ searchParams: Promise.resolve(searchParams) });
  return renderEn(page);
}

let onLine = true;

beforeEach(() => {
  onLine = true;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => onLine);
  window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList);
  // jsdom has no WebAuthn; tests opt in.
  Reflect.deleteProperty(window, 'PublicKeyCredential');
  client.magicLink.mockResolvedValue({ data: { status: true }, error: null });
  client.social.mockResolvedValue({ data: { url: 'https://accounts.google.com' }, error: null });
  client.passkey.mockResolvedValue({ data: null, error: { code: 'AUTH_CANCELLED' } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  client.magicLink.mockReset();
  client.social.mockReset();
  client.passkey.mockReset();
  client.sso.mockReset();
  state.googleEnabled = false;
  state.session = null;
});

describe('Google button', () => {
  it('is absent when AUTH_GOOGLE_ENABLED is off, without console errors', async () => {
    const errors = vi.spyOn(console, 'error');
    await renderPage();
    expect(screen.queryByRole('button', { name: en.signIn.google })).toBeNull();
    expect(screen.queryByTestId('google-sign-in')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it('appears when AUTH_GOOGLE_ENABLED is on and starts the Google flow back to next', async () => {
    state.googleEnabled = true;
    await renderPage({ next: '/w/anything' });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.google }));
    await waitFor(() => {
      expect(client.social).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: '/w/anything',
        errorCallbackURL: '/sign-in?next=%2Fw%2Fanything',
      });
    });
  });
});

describe('passkey button', () => {
  it('is disabled with a reason when the browser has no WebAuthn', () => {
    renderEn(<SignInForm {...formProps} />);
    const button = screen.getByRole('button', { name: en.signIn.passkey });
    expect(button).toHaveProperty('disabled', true);
    const hint = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(en.signIn.passkeyUnsupported);
  });

  it('is enabled and starts conditional UI where supported', async () => {
    const isConditionalMediationAvailable = vi.fn(() => Promise.resolve(true));
    Object.assign(window, {
      PublicKeyCredential: Object.assign(function PublicKeyCredential() {}, {
        isConditionalMediationAvailable,
      }),
    });
    renderEn(<SignInForm {...formProps} />);
    const button = screen.getByRole('button', { name: en.signIn.passkey });
    expect(button).toHaveProperty('disabled', false);
    await waitFor(() => {
      expect(client.passkey).toHaveBeenCalledWith({ autoFill: true });
    });
    // A cancelled ceremony is not an error.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the generic error when a passkey sign-in fails (but not when cancelled)', async () => {
    Object.assign(window, { PublicKeyCredential: function PublicKeyCredential() {} });
    client.passkey.mockResolvedValue({ data: null, error: { message: 'bad', status: 401 } });
    renderEn(<SignInForm {...formProps} />);
    fireEvent.click(screen.getByRole('button', { name: en.signIn.passkey }));
    expect((await screen.findByRole('alert')).textContent).toBe(en.signIn.errors.generic);
    expect(client.passkey).toHaveBeenCalledWith({ autoFill: false });
  });

  it('offers passkeys in the email field (conditional UI autocomplete)', () => {
    renderEn(<SignInForm {...formProps} />);
    expect(screen.getByLabelText(en.signIn.emailLabel).getAttribute('autocomplete')).toBe(
      'username webauthn',
    );
  });
});

describe('magic link', () => {
  it('sends a link to next and shows the address with a 10-minute expiry', async () => {
    renderEn(<SignInForm {...formProps} />);
    fireEvent.change(screen.getByLabelText(en.signIn.emailLabel), {
      target: { value: ' advocate@example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.submit }));

    expect(await screen.findByRole('heading', { name: en.checkEmail.title })).toBeTruthy();
    expect(client.magicLink).toHaveBeenCalledWith({
      email: 'advocate@example.com',
      callbackURL: '/w/anything',
      errorCallbackURL: '/sign-in?next=%2Fw%2Fanything',
    });
    expect(
      screen.getByText('We sent a sign-in link to advocate@example.com. It expires in 10 minutes.'),
    ).toBeTruthy();
  });

  it('shows Sending... and disables the field while the request is in flight', async () => {
    let finish: (value: unknown) => void = () => undefined;
    client.magicLink.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderEn(<SignInForm {...formProps} />);
    const input = screen.getByLabelText(en.signIn.emailLabel);
    fireEvent.change(input, { target: { value: 'a@example.com' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(await screen.findByText(en.signIn.sending)).toBeTruthy();
    expect(input).toHaveProperty('disabled', true);
    await act(async () => {
      finish({ data: { status: true }, error: null });
      await Promise.resolve();
    });
  });

  it('shows the send error as an alert', async () => {
    client.magicLink.mockResolvedValue({ data: null, error: { message: 'nope', status: 500 } });
    renderEn(<SignInForm {...formProps} />);
    fireEvent.change(screen.getByLabelText(en.signIn.emailLabel), {
      target: { value: 'a@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('We could not send the link. Try again in a moment.');
  });

  it('goes back to the form with Use a different email', async () => {
    renderEn(<SignInForm {...formProps} />);
    fireEvent.change(screen.getByLabelText(en.signIn.emailLabel), {
      target: { value: 'a@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.submit }));
    fireEvent.click(await screen.findByRole('button', { name: en.checkEmail.differentEmail }));
    expect(screen.getByLabelText(en.signIn.emailLabel)).toBeTruthy();
  });
});

describe('check-email resend', () => {
  it('unlocks Resend after 30 seconds', async () => {
    vi.useFakeTimers();
    const onResend = vi.fn(() => Promise.resolve());
    renderEn(
      <CheckEmail
        email="a@example.com"
        expiresInMinutes={10}
        onUseDifferentEmail={() => undefined}
        onResend={onResend}
      />,
    );
    expect(screen.getByRole('button', { name: 'Resend in 30s' })).toHaveProperty('disabled', true);
    for (let i = 0; i < RESEND_AFTER_SECONDS; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    const resend = screen.getByRole('button', { name: en.checkEmail.resend });
    expect(resend).toHaveProperty('disabled', false);
    await act(async () => {
      fireEvent.click(resend);
      await Promise.resolve();
    });
    expect(onResend).toHaveBeenCalledOnce();
  });
});

describe('states', () => {
  it.each([
    [{ error: 'access_denied' }, 'Access was not granted.'],
    [{ error: 'EXPIRED_TOKEN' }, 'This link has expired. Request a new one.'],
    [{ error: 'INVALID_TOKEN' }, 'This link has expired. Request a new one.'],
    [{ error: 'something_else' }, en.signIn.errors.generic],
  ])('renders %j as %j in an alert', async (params, copy) => {
    await renderPage(params);
    expect(screen.getByRole('alert').textContent).toBe(copy);
  });

  it('renders the offline copy and blocks sending', () => {
    onLine = false;
    renderEn(<SignInForm {...formProps} />);
    expect(screen.getByRole('alert').textContent).toBe('You are offline. Connect to sign in.');
    expect(screen.getByRole('button', { name: en.signIn.submit })).toHaveProperty('disabled', true);
  });

  it('reacts to going offline and back online', () => {
    renderEn(<SignInForm {...formProps} />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      onLine = false;
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('alert').textContent).toBe(en.signIn.errors.offline);
    act(() => {
      onLine = true;
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('sign-in page', () => {
  it('renders the designed heading, tagline and footer copy', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to CauseDeck' })).toBeTruthy();
    expect(screen.getByText('Your court day, prepared.')).toBeTruthy();
    expect(screen.getByText('India-hosted. Your matter data never leaves India.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Terms' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeTruthy();
    // #175: the compact language switcher sits in the footer.
    const globe = screen.getByRole('button', { name: 'Language: English' });
    expect(globe.closest('footer')).toBeTruthy();
  });

  it('sends a signed-in user to a safe next', async () => {
    state.session = { user: { id: 'u1' } };
    await expect(
      SignInPage({ searchParams: Promise.resolve({ next: '/w/demo' }) }),
    ).rejects.toThrow('NEXT_REDIRECT /w/demo');
  });

  it('never redirects a signed-in user off-site', async () => {
    state.session = { user: { id: 'u1' } };
    await expect(
      SignInPage({ searchParams: Promise.resolve({ next: '//evil.com' }) }),
    ).rejects.toThrow('NEXT_REDIRECT /');
    await expect(
      SignInPage({ searchParams: Promise.resolve({ next: 'https://evil.com' }) }),
    ).rejects.toThrow(/^NEXT_REDIRECT \/$/);
  });

  it('passes a sanitised next to the magic link', async () => {
    await renderPage({ next: '//evil.com' });
    fireEvent.change(screen.getByLabelText(en.signIn.emailLabel), {
      target: { value: 'a@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.submit }));
    await waitFor(() => {
      expect(client.magicLink).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: '/', errorCallbackURL: '/sign-in' }),
      );
    });
  });
});

describe('SSO sign-in (#683)', () => {
  const start = async (email: string) => {
    await renderPage({ next: '/w/anything' });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.sso.open }));
    fireEvent.change(screen.getByLabelText(en.signIn.sso.emailLabel), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.sso.submit }));
  };

  it('starts SSO for the work email and returns to next', async () => {
    client.sso.mockResolvedValue({ data: { url: 'https://idp.example.com' }, error: null });
    await start('a@firm.example.com');
    await waitFor(() => {
      expect(client.sso).toHaveBeenCalledWith({
        email: 'a@firm.example.com',
        callbackURL: '/w/anything',
        errorCallbackURL: '/sign-in?next=%2Fw%2Fanything',
      });
    });
  });

  it('shows the same message for an unknown domain and for a failed request', async () => {
    client.sso.mockResolvedValue({ data: null, error: { message: 'No provider found' } });
    await start('a@unknown.example.com');
    expect((await screen.findByRole('alert')).textContent).toBe(en.signIn.sso.failed);
    cleanup();
    client.sso.mockRejectedValue(new Error('network'));
    await start('a@firm.example.com');
    expect((await screen.findByRole('alert')).textContent).toBe(en.signIn.sso.failed);
  });
});
