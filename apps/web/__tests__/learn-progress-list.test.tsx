// @vitest-environment jsdom
// `/account` practice-school progress (#703): the count line, marking and un-marking through the
// action (with rollback and a toast on failure), offline controls, and every string in en, ta, kn.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs, type TestLocale } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@causedeck/ui/sonner', () => ({ toast }));

const { LearnProgressList } = await import('../components/settings/learn-progress-list.tsx');

const en = catalogs.en.settings.account.learn;
const SLUGS = [
  'court-day-practice',
  'reading-cause-lists',
  'listings-and-mentions',
  'filing-and-defect-cures',
  'limitation-basics',
  'using-the-os',
];
const modules = (done: string[] = []) => SLUGS.map((slug) => ({ slug, done: done.includes(slug) }));
const missing: string[] = [];
const withIntl = (ui: React.ReactNode, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={catalogs[locale]}
      onError={(error: IntlError) => {
        missing.push(error.message);
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
const ok = (slug: string, done: boolean) =>
  Promise.resolve({ ok: true as const, data: { slug, done } });

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

describe('LearnProgressList', () => {
  it('shows every module with its state and the count', () => {
    withIntl(<LearnProgressList modules={modules(['limitation-basics'])} setDone={vi.fn()} />);
    expect(screen.getByText('1 of 6 modules done')).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: en.listLabel })).getAllByRole('listitem');
    expect(rows).toHaveLength(6);
    expect(rows[4]?.getAttribute('data-done')).toBe('true');
    expect(rows[0]?.getAttribute('data-done')).toBe('false');
    expect(missing).toEqual([]);
  });

  it('marks a module done, updates the count at once and refreshes', async () => {
    const setDone = vi.fn((input: { slug: string; done: boolean }) => ok(input.slug, input.done));
    withIntl(<LearnProgressList modules={modules()} setDone={setDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark Court-day practice as done' }));
    await waitFor(() => {
      expect(setDone).toHaveBeenCalledWith({ slug: 'court-day-practice', done: true });
    });
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.toast.done);
    });
    expect(screen.getByText('1 of 6 modules done')).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
    expect(
      await screen.findByRole('button', { name: 'Mark Court-day practice as not done' }),
    ).toBeTruthy();
  });

  it('un-marks a done module', async () => {
    const setDone = vi.fn((input: { slug: string; done: boolean }) => ok(input.slug, input.done));
    withIntl(<LearnProgressList modules={modules(['using-the-os'])} setDone={setDone} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Mark Using CauseDeck as your practice desk as not done',
      }),
    );
    await waitFor(() => {
      expect(setDone).toHaveBeenCalledWith({ slug: 'using-the-os', done: false });
    });
    await waitFor(() => {
      expect(screen.getByText('0 of 6 modules done')).toBeTruthy();
    });
  });

  it('rolls back and says so when the save fails', async () => {
    const setDone = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'INTERNAL' as const, message: '' } }),
    );
    withIntl(<LearnProgressList modules={modules()} setDone={setDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark Reading cause lists as done' }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.toast.failed);
    });
    expect(screen.getByText('0 of 6 modules done')).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('disables the buttons offline', () => {
    setOnline(false);
    withIntl(<LearnProgressList modules={modules()} setDone={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('resolves every string in Tamil and Kannada', () => {
    for (const locale of ['ta', 'kn'] as const) {
      withIntl(
        <LearnProgressList modules={modules(['limitation-basics'])} setDone={vi.fn()} />,
        locale,
      );
      expect(screen.getAllByRole('button')).toHaveLength(6);
      cleanup();
    }
    expect(missing).toEqual([]);
  });
});
