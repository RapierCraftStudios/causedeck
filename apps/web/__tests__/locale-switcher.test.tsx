// @vitest-environment jsdom
// Locale switcher (#175): options in their own script, the active one checked, and a change that
// persists through the server action, refreshes in place and toasts in the new language. Browser
// flows (cookie, user record, <html lang>, fonts, axe) live in e2e/tests/i18n/switch-locale.spec.ts.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from './helpers/intl.ts';

const setLocaleAction = vi.hoisted(() => vi.fn());
vi.mock('../app/(app)/account/actions.ts', () => ({ setLocaleAction }));

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));

const { LocaleSwitcher } = await import('../components/locale-switcher.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderEn(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const LABELS = { en: 'English', ta: 'தமிழ்', kn: 'ಕನ್ನಡ' } as const;

/** The text of the element a toast was raised with (`<span lang>message</span>`). */
function toastText(call: unknown[]): { lang: string; text: string } {
  const el = call[0] as { props: { lang: string; children: string } };
  return { lang: el.props.lang, text: el.props.children };
}

describe('LocaleSwitcher (#175)', () => {
  it('lists English, தமிழ் and ಕನ್ನಡ in their own script, the active locale checked', () => {
    renderEn(<LocaleSwitcher variant="list" />);
    const group = screen.getByRole('group', { name: catalogs.en.locale.label });
    expect(group).toBeTruthy();
    for (const [locale, label] of Object.entries(LABELS)) {
      const radio = screen.getByRole<HTMLInputElement>('radio', { name: label });
      expect(radio.closest('label')?.getAttribute('lang')).toBe(locale);
      expect(radio.checked).toBe(locale === 'en');
    }
  });

  it('persists the choice, refreshes in place and toasts in the new language', async () => {
    setLocaleAction.mockResolvedValue({
      ok: true,
      data: { locale: 'ta', message: catalogs.ta.locale.updated },
    });
    renderEn(<LocaleSwitcher variant="list" />);
    fireEvent.click(screen.getByRole('radio', { name: LABELS.ta }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledOnce();
    });
    expect(setLocaleAction).toHaveBeenCalledWith({ locale: 'ta' });
    expect(refresh).toHaveBeenCalledOnce();
    expect(toastText(toast.success.mock.calls[0] as unknown[])).toEqual({
      lang: 'ta',
      text: catalogs.ta.locale.updated,
    });
  });

  it('checks the picked option at once, and reverts it when saving fails', async () => {
    let settle: (value: unknown) => void = () => undefined;
    setLocaleAction.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderEn(<LocaleSwitcher variant="list" />);
    const kannada = screen.getByRole<HTMLInputElement>('radio', { name: LABELS.kn });
    fireEvent.click(kannada);
    await waitFor(() => {
      expect(kannada.checked).toBe(true);
    });
    settle({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong.' } });
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: LABELS.en }).checked).toBe(true);
    });
    expect(kannada.checked).toBe(false);
  });

  it('does nothing when the active locale is picked again', () => {
    renderEn(<LocaleSwitcher variant="list" />);
    fireEvent.click(screen.getByRole('radio', { name: LABELS.en }));
    expect(setLocaleAction).not.toHaveBeenCalled();
  });

  it('shows the action error and does not refresh when the save fails', async () => {
    setLocaleAction.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
    });
    renderEn(<LocaleSwitcher variant="list" />);
    fireEvent.click(screen.getByRole('radio', { name: LABELS.kn }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledOnce();
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('compact: a globe button names the language and opens the radio list; Escape closes it', () => {
    renderEn(<LocaleSwitcher variant="compact" />);
    const button = screen.getByRole('button', { name: `${catalogs.en.locale.label}: English` });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radio')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const checked = screen.getByRole<HTMLInputElement>('radio', { name: LABELS.en });
    expect(checked.checked).toBe(true);
    expect(document.activeElement).toBe(checked);
    expect(screen.getAllByRole('radio')).toHaveLength(3);

    fireEvent.keyDown(checked, { key: 'Escape' });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('menu: renders the given radio primitives with each option in its own script', () => {
    const RadioGroup = ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: ReactNode;
    }) => (
      <div
        role="radiogroup"
        data-value={value}
        onClick={() => {
          onValueChange('kn');
        }}
      >
        {children}
      </div>
    );
    const RadioItem = ({
      value,
      lang,
      children,
    }: {
      value: string;
      lang: string;
      children: ReactNode;
    }) => (
      <div role="menuitemradio" aria-checked={value === 'en'} lang={lang}>
        {children}
      </div>
    );
    setLocaleAction.mockResolvedValue({
      ok: true,
      data: { locale: 'kn', message: catalogs.kn.locale.updated },
    });
    renderEn(<LocaleSwitcher variant="menu" menu={{ RadioGroup, RadioItem }} />);
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((item) => [item.getAttribute('lang'), item.textContent])).toEqual([
      ['en', LABELS.en],
      ['ta', LABELS.ta],
      ['kn', LABELS.kn],
    ]);
    expect(screen.getByRole('radiogroup').dataset.value).toBe('en');
    fireEvent.click(screen.getByRole('radiogroup'));
    expect(setLocaleAction).toHaveBeenCalledWith({ locale: 'kn' });
  });
});
