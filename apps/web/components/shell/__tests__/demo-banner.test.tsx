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
  it('says "Demo workspace, sample data" in the demo workspaces', () => {
    for (const slug of ['demo', 'demo-chennai-solo', 'demo-bengaluru-chamber']) {
      cleanup();
      renderBanner(slug);
      const status = screen.getByRole('status');
      expect(status).toBe(banner());
      expect(status.textContent).toContain('Demo workspace, sample data');
      expect(status.textContent).toContain(
        'Sample data only. Nothing here is real, and nothing leaves this workspace.',
      );
    }
  });

  it('offers Leave demo and Start your own workspace, both posting to /demo/leave, never dismissing', () => {
    renderBanner('demo-chennai-solo');
    const form = banner()?.querySelector('form');
    expect(form?.getAttribute('action')).toBe('/demo/leave');
    expect(form?.getAttribute('method')).toBe('post');
    const buttons = [...(form?.querySelectorAll('button') ?? [])];
    expect(buttons.map((b) => [b.textContent, b.value])).toEqual([
      ['Leave demo', 'leave'],
      ['Start your own workspace', 'start'],
    ]);
    // The primary button shows from 768 px; at 360 only the text button.
    expect(buttons[1]?.className).toContain('hidden');
    expect(buttons[1]?.className).toContain('md:inline-flex');
    expect(buttons[0]?.className).not.toContain('hidden');
    // Info colours, never the danger colours.
    expect(banner()?.getAttribute('data-tone')).toBe('info');
    expect(banner()?.className).not.toContain('danger');
  });

  it('renders nothing in any other workspace', () => {
    renderBanner('clerk-desk');
    expect(banner()).toBeNull();
    cleanup();
    renderBanner('demonstrations');
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
    expect(banner()?.textContent).toContain('Demo workspace, sample data');
    // Above the page, outside main.
    expect(document.querySelector('main#main [data-demo-banner]')).toBeNull();
    cleanup();
    shell('clerk-desk');
    expect(banner()).toBeNull();
  });
});
