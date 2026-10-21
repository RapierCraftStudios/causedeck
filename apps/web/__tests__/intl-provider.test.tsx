// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { useTranslations } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntlProvider } from '../components/intl-provider.tsx';

import { catalogs } from './helpers/intl.ts';

function Probe({ id }: { id: string }) {
  const t = useTranslations();
  return <p>{t(id as Parameters<typeof t>[0])}</p>;
}

afterEach(() => vi.restoreAllMocks());

describe('IntlProvider (#174 missing keys)', () => {
  it('renders the active catalog', () => {
    render(
      <IntlProvider locale="ta" messages={catalogs.ta} timeZone="Asia/Kolkata" mode="development">
        <Probe id="nav.today" />
      </IntlProvider>,
    );
    expect(screen.getByText(catalogs.ta.nav.today)).toBeTruthy();
  });

  it('in development shows the key and logs a warning, never an empty string', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <IntlProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata" mode="development">
        <Probe id="nav.notAKey" />
      </IntlProvider>,
    );
    expect(screen.getByText('nav.notAKey')).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MISSING_MESSAGE'));
  });

  it('in production reports instead of warning and still renders text', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <IntlProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata" mode="production">
        <Probe id="nav.stillMissing" />
      </IntlProvider>,
    );
    expect(screen.getByText('nav.stillMissing')).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[i18n]', 'MISSING_MESSAGE', expect.any(String));
  });
});
