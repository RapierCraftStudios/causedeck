// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs, fakeGetTranslations, type TestLocale } from './helpers/intl.ts';

interface LayoutTestState {
  locale: string;
  nonce: string | null;
  themeProps: Record<string, unknown> | undefined;
  theme: string;
  setTheme: (theme: string) => void;
  /** `null` signed out; otherwise the signed-in user's membership slugs. */
  memberships: string[] | null;
  lastWorkspace: string | undefined;
}

const state = vi.hoisted((): LayoutTestState => ({
  locale: 'en',
  nonce: 'test-nonce',
  memberships: null,
  lastWorkspace: undefined,
  themeProps: undefined,
  theme: 'system',
  setTheme: () => undefined,
}));

vi.mock('next/font/local', () => import('./helpers/font-mock.ts'));
vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve(new Headers(state.nonce === null ? {} : { 'x-nonce': state.nonce })),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'cd_last_ws' && state.lastWorkspace !== undefined
          ? { value: state.lastWorkspace }
          : undefined,
    }),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  loadMemberships: () =>
    Promise.resolve(
      state.memberships === null
        ? null
        : {
            session: {},
            memberships: state.memberships.map((slug, i) => ({
              workspace: { id: `ws-${String(i)}`, slug, name: slug },
              role: 'owner',
            })),
          },
    ),
}));
vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve(state.locale),
  getMessages: () => Promise.resolve(catalogs[state.locale as TestLocale]),
  getTimeZone: () => Promise.resolve('Asia/Kolkata'),
  getTranslations: (namespace?: string) =>
    fakeGetTranslations(state.locale as TestLocale)(namespace),
}));
vi.mock('next-themes', () => ({
  ThemeProvider: ({ children, ...props }: { children: ReactNode }) => {
    state.themeProps = props;
    return <>{children}</>;
  },
  useTheme: () => ({ theme: state.theme, setTheme: state.setTheme }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('../components/lazy-toaster.tsx', () => ({ LazyToaster: () => <div data-toaster="" /> }));

const { default: RootLayout } = await import('../app/layout.tsx');
const { ThemeToggle } = await import('../components/theme-toggle.tsx');
const { loadedFonts } = await import('./helpers/font-mock.ts');
const { default: HomePage } = await import('../app/page.tsx');
const { homeDestination } = await import('../lib/home-route.ts');

async function renderLayout(locale: string): Promise<Document> {
  state.locale = locale;
  const element = await RootLayout({ children: <main id="main">content</main> });
  return new DOMParser().parseFromString(renderToStaticMarkup(element), 'text/html');
}

beforeEach(() => {
  state.nonce = 'test-nonce';
  state.themeProps = undefined;
  state.memberships = null;
  state.lastWorkspace = undefined;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RootLayout', () => {
  it.each(['en', 'ta', 'kn'])('sets <html lang> from the locale (%s)', async (locale) => {
    const doc = await renderLayout(locale);
    expect(doc.documentElement.getAttribute('lang')).toBe(locale);
  });

  it('wires only the Latin fonts for en, and the Indic face only for its locale', async () => {
    const en = (await renderLayout('en')).documentElement.className;
    const ta = (await renderLayout('ta')).documentElement.className;
    const kn = (await renderLayout('kn')).documentElement.className;

    for (const latin of [
      'var-geist-latin-wght',
      'var-newsreader-latin-wght',
      'var-geist-mono-latin-wght',
    ]) {
      expect(en).toContain(latin);
    }
    expect(en).not.toMatch(/noto-sans/);
    expect(ta).toContain('var-noto-sans-tamil-wght');
    expect(ta).not.toContain('kannada');
    expect(kn).toContain('var-noto-sans-kannada-wght');
    expect(kn).not.toContain('tamil');
  });

  it('never preloads the Indic fonts and loads every face from packages/ui/fonts', () => {
    const indic = loadedFonts.filter((font) => JSON.stringify(font.src).includes('noto-sans'));
    expect(indic).toHaveLength(2);
    expect(indic.every((font) => font.preload === false)).toBe(true);
    for (const font of loadedFonts)
      expect(JSON.stringify(font.src)).toContain('packages/ui/fonts/');
  });

  it('configures next-themes with the class strategy, system default and the CSP nonce', async () => {
    await renderLayout('en');
    expect(state.themeProps).toMatchObject({
      attribute: 'class',
      defaultTheme: 'system',
      enableSystem: true,
      disableTransitionOnChange: true,
      nonce: 'test-nonce',
    });
  });

  it('omits the nonce prop when the proxy did not run', async () => {
    state.nonce = null;
    await renderLayout('en');
    expect(state.themeProps).not.toHaveProperty('nonce');
  });

  it('renders the skip link as the first focusable element, targeting #main', async () => {
    const doc = await renderLayout('en');
    const firstFocusable = doc.body.querySelector('a[href], button, input, [tabindex]');
    expect(firstFocusable?.getAttribute('href')).toBe('#main');
    expect(firstFocusable?.textContent).toBe('Skip to content');
    expect(doc.getElementById('main')).not.toBeNull();
  });

  it('mounts the toaster', async () => {
    const doc = await renderLayout('ta');
    expect(doc.querySelector('[data-toaster]')).not.toBeNull();
    expect(doc.body.textContent).toContain(catalogs.ta.common.skipToContent);
  });
});

describe('ThemeToggle', () => {
  function renderToggle(locale: TestLocale = 'en') {
    return render(
      <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
        <ThemeToggle />
      </NextIntlClientProvider>,
    );
  }

  it('is a three-way segmented control with labels', () => {
    renderToggle();
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(group).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Light',
      'Dark',
      'System',
    ]);
  });

  it('reflects the current theme and persists a new choice to next-themes and a cookie', () => {
    state.theme = 'light';
    const setTheme = vi.fn();
    state.setTheme = setTheme;
    renderToggle();
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(document.cookie).toContain('theme=dark');
  });

  it('renders translated labels for ta', () => {
    renderToggle('ta');
    expect(screen.getByRole('group', { name: catalogs.ta.theme.label })).toBeTruthy();
  });
});

describe('home route', () => {
  it('renders the placeholder home: serif wordmark, one calm line, theme toggle, sign-in link', async () => {
    state.locale = 'en';
    render(
      <NextIntlClientProvider locale="en" messages={catalogs.en}>
        {await HomePage()}
      </NextIntlClientProvider>,
    );

    const wordmark = screen.getByRole('heading', { level: 1 });
    expect(wordmark.textContent).toBe('CauseDeck');
    expect(wordmark.className).toContain('font-serif');
    expect(wordmark.className).toContain('text-3xl');
    expect(screen.getByText('Your court day, prepared.').className).toContain('text-base');
    expect(screen.getByRole('group', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in');
    const main = document.getElementById('main');
    expect(main?.tagName).toBe('MAIN');
    expect(main?.parentElement?.className).toContain('max-w-[1200px]');
    expect(main?.parentElement?.className).toMatch(/px-4 .*md:px-6 .*xl:px-8/);
    expect(document.querySelector('img, svg:not([aria-hidden])')).toBeNull();
  });

  it('sends a signed-in user to their last workspace Today, or onboarding with none', () => {
    expect(homeDestination({ lastWorkspaceSlug: 'chambers-1' })).toBe('/w/chambers-1/today');
    expect(homeDestination({ lastWorkspaceSlug: null })).toBe('/onboarding');
    expect(homeDestination(null)).toBeNull();
  });

  it('lands on the cd_last_ws workspace while it is still a membership (#179)', async () => {
    state.memberships = ['chennai-solo', 'bengaluru-chamber'];
    state.lastWorkspace = 'bengaluru-chamber';
    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT /w/bengaluru-chamber/today');
    state.lastWorkspace = 'someone-elses';
    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT /w/chennai-solo/today');
  });

  it('sends a signed-in user with no workspace to /onboarding', async () => {
    state.memberships = [];
    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT /onboarding');
  });
});
