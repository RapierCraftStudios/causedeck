// @vitest-environment jsdom
import { defaultSnapshot } from '@causedeck/flags/keys';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs, type TestLocale } from '../../../__tests__/helpers/intl.ts';
import { testWorkspaceContext } from '../../../__tests__/helpers/workspace.ts';

import { mockMatchMedia, renderWithIntl, stubResizeObserver } from './helpers.tsx';

vi.mock('next/navigation', () => ({
  usePathname: () => '/w/demo/today',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { AppShell } = await import('../app-shell.tsx');
const { DemoBanner } = await import('../demo-banner.tsx');

const banner = () => document.querySelector('[data-demo-banner]');

const renderBanner = (slug: string, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      <DemoBanner slug={slug} />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  mockMatchMedia();
  stubResizeObserver();
});

afterEach(cleanup);

describe('DemoBanner (#182)', () => {
  it('says "Demo data — fictional" in the demo workspace', () => {
    renderBanner('demo');
    const status = screen.getByRole('status');
    expect(status).toBe(banner());
    expect(status.textContent).toContain('Demo data — fictional');
    expect(status.textContent).toContain(catalogs.en.shell.demoBanner.hint);
    // Not dismissible.
    expect(status.querySelector('button')).toBeNull();
  });

  it('renders nothing in any other workspace', () => {
    renderBanner('clerk-desk');
    expect(banner()).toBeNull();
  });

  it.each(['ta', 'kn'] as const)('is translated for %s', (locale) => {
    renderBanner('demo', locale);
    const copy = catalogs[locale].shell.demoBanner;
    expect(copy.label).not.toBe(catalogs.en.shell.demoBanner.label);
    expect(banner()?.textContent).toContain(copy.label);
  });

  it('is shown by the app shell for the demo workspace only', () => {
    const shell = (slug: string) =>
      renderWithIntl(
        <AppShell
          context={testWorkspaceContext(slug)}
          sidebarState="auto"
          flags={defaultSnapshot()}
        >
          <p>content</p>
        </AppShell>,
      );
    shell('demo');
    expect(banner()?.textContent).toContain('Demo data — fictional');
    // Above the page, outside main.
    expect(document.querySelector('main#main [data-demo-banner]')).toBeNull();
    cleanup();
    shell('clerk-desk');
    expect(banner()).toBeNull();
  });
});
