// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { catalogs, type TestLocale } from '../../../__tests__/helpers/intl.ts';
import { OwnerTwoFactorBanner, TWO_FACTOR_SETUP_HREF } from '../owner-two-factor-banner.tsx';

const renderBanner = (
  state: Parameters<typeof OwnerTwoFactorBanner>[0]['state'],
  locale: TestLocale = 'en',
) =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      <OwnerTwoFactorBanner state={state} />
    </NextIntlClientProvider>,
  );

const banner = () => document.querySelector('[data-slot="owner-two-factor-banner"]');

afterEach(cleanup);

describe('OwnerTwoFactorBanner (#290)', () => {
  it('renders nothing unless the owner is past the 2FA grace', () => {
    for (const state of ['not-owner', 'enabled', 'grace'] as const) {
      renderBanner(state);
      expect(banner()).toBeNull();
      cleanup();
    }
  });

  it('is a status message with a link to the two-factor setup', () => {
    renderBanner('required');
    const status = screen.getByRole('status');
    expect(status).toBe(banner());
    expect(status.textContent).toContain(catalogs.en.shell.ownerTwoFactor.message);
    const link = screen.getByRole('link', { name: catalogs.en.shell.ownerTwoFactor.action });
    expect(link.getAttribute('href')).toBe(TWO_FACTOR_SETUP_HREF);
    expect(TWO_FACTOR_SETUP_HREF).toBe('/account#two-factor');
    // Not dismissible: no close button.
    expect(status.querySelector('button')).toBeNull();
  });

  it.each(['ta', 'kn'] as const)('is translated for %s', (locale) => {
    renderBanner('required', locale);
    const copy = catalogs[locale].shell.ownerTwoFactor;
    expect(copy.message).not.toBe(catalogs.en.shell.ownerTwoFactor.message);
    expect(banner()?.textContent).toContain(copy.message);
    expect(screen.getByRole('link', { name: copy.action })).toBeTruthy();
  });
});
