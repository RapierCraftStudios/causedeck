// @vitest-environment jsdom
import { NOT_FOUND_COPY } from '@causedeck/ui/patterns';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setErrorReporter, type ErrorReporter } from '../lib/report-error.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next-intl/server', () => ({ getTranslations: fakeGetTranslations('en') }));

const { default: RouteError } = await import('../app/error.tsx');
const { default: GlobalError } = await import('../app/global-error.tsx');
const { default: NotFoundPage } = await import('../app/not-found.tsx');
const { default: Loading } = await import('../app/loading.tsx');
const { default: OfflinePage } = await import('../app/(public)/offline/page.tsx');

const withIntl = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      {ui}
    </NextIntlClientProvider>,
  );

function leakyError(): Error & { digest?: string } {
  const error: Error & { digest?: string } = new Error('SELECT * FROM matters failed: secret-dsn');
  error.stack = 'Error: secret\n    at handler (/srv/app/lib/db.ts:42:7)';
  error.digest = 'd1g35t';
  return error;
}

let reporter: ReturnType<typeof vi.fn<ErrorReporter>>;

beforeEach(() => {
  reporter = vi.fn<ErrorReporter>();
  setErrorReporter(reporter);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('app/error.tsx', () => {
  it('renders the designed error state with Try again and Go to Today', () => {
    const reset = vi.fn();
    withIntl(<RouteError error={leakyError()} reset={reset} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(catalogs.en.error.title);
    expect(document.querySelector('[data-pattern-state="error"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Go to Today' }).getAttribute('href')).toBe('/');
  });

  it('moves focus to the heading and reports to the logger hook with the digest', () => {
    const error = leakyError();
    withIntl(<RouteError error={error} reset={() => undefined} />);

    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(reporter).toHaveBeenCalledWith(error, { boundary: 'route', digest: 'd1g35t' });
  });

  it('never shows the message or stack in production, only the digest', () => {
    vi.stubEnv('NODE_ENV', 'production');
    withIntl(<RouteError error={leakyError()} reset={() => undefined} />);

    const text = document.body.textContent;
    expect(text).not.toContain('secret');
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('db.ts');
    expect(text).toContain('Reference: d1g35t');
  });
});

describe('app/global-error.tsx', () => {
  it('renders the error state, reports, focuses the heading and hides details', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // <html> inside the test container
    const reset = vi.fn();
    const error = leakyError();
    render(<GlobalError error={error} reset={reset} />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(document.activeElement).toBe(heading);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Go to Today' }).getAttribute('href')).toBe('/');
    expect(reporter).toHaveBeenCalledWith(error, { boundary: 'global', digest: 'd1g35t' });
    expect(document.body.textContent).not.toContain('secret');
  });
});

describe('app/not-found.tsx', () => {
  it('renders the not-found state screen with a way back to Today', () => {
    withIntl(<NotFoundPage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
    expect(document.querySelector('[data-pattern-state="not-found"]')?.textContent).toContain(
      NOT_FOUND_COPY,
    );
    expect(screen.getByRole('link', { name: 'Go to Today' }).getAttribute('href')).toBe('/');
    expect(document.getElementById('main')).not.toBeNull();
  });
});

describe('app/loading.tsx', () => {
  it('renders the skeleton status region and the 2 px accent progress bar', () => {
    render(<Loading />);

    expect(screen.getByRole('status').textContent).toContain('Loading');
    const bar = document.querySelector('[data-slot="route-progress"]');
    expect(bar?.className).toContain('bg-accent');
    expect(bar?.className).toContain('h-[2px]');
    expect(bar?.className).toContain('cd-progress-bar');
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('app/(public)/offline/page.tsx', () => {
  it('says what works offline and what does not, and links back (#50)', () => {
    withIntl(<OfflinePage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      catalogs.en.pwa.offline.title,
    );
    expect(screen.getByText(catalogs.en.pwa.offline.works.saved)).toBeTruthy();
    expect(screen.getByText(catalogs.en.pwa.offline.works.capture)).toBeTruthy();
    expect(screen.getByText(catalogs.en.pwa.offline.doesNot.items)).toBeTruthy();
    expect(screen.getByText(catalogs.en.pwa.offline.outbox.none)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Today' }).getAttribute('href')).toBe('/');
  });
});
