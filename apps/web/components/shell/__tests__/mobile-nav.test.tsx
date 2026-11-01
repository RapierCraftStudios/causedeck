// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockMatchMedia, renderWithIntl, stubResizeObserver } from './helpers.tsx';

const nav = vi.hoisted(() => ({ pathname: '/w/demo/today' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { MobileNav } = await import('../mobile-nav.tsx');
const { loadShellOverlays } = await import('../use-shell-overlays.ts');
const notifications = await import('../../notifications/use-notifications.ts');

const bar = () => screen.getByRole('navigation', { name: 'Bottom navigation' });
const slots = () => [...bar().querySelectorAll<HTMLElement>(':scope > ul > li')];

const openMore = () => {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  return screen.getByRole('dialog', { name: 'More destinations' });
};

const moreIds = (sheet: HTMLElement) =>
  [...sheet.querySelectorAll<HTMLElement>('a[data-more-item]')].map((a) => a.dataset.moreItem);

beforeEach(async () => {
  nav.pathname = '/w/demo/today';
  mockMatchMedia();
  stubResizeObserver();
  await loadShellOverlays();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('mobile bottom navigation', () => {
  it('shows Today, Inbox, Capture, Matters, Obligations and More in order, each with a text label', () => {
    renderWithIntl(<MobileNav slug="demo" role="owner" />);
    expect(slots().map((slot) => slot.textContent)).toEqual([
      'Today',
      'Inbox',
      'Capture',
      'Matters',
      'Obligations',
      'More',
    ]);
    for (const slot of slots()) {
      const target = slot.querySelector<HTMLElement>('a, button');
      expect(target?.className).toMatch(/\bmin-h-11\b/);
      expect(target?.className).toMatch(/\bmin-w-11\b/);
      // The label is visible text, not only an aria-label.
      expect(target?.getAttribute('aria-label')).toBeNull();
    }
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('href')).toBe('/w/demo/today');
  });

  it('is a fixed bar on phones only, 56 px plus the safe-area inset', () => {
    renderWithIntl(<MobileNav slug="demo" role="owner" />);
    const classes = bar().className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(['md:hidden', 'fixed', 'inset-x-0', 'bottom-0']),
    );
    expect(classes).toContain('h-[calc(56px+env(safe-area-inset-bottom))]');
    expect(classes).toContain('pb-[env(safe-area-inset-bottom)]');
  });

  it('marks the current destination with aria-current=page', () => {
    renderWithIntl(<MobileNav slug="demo" role="owner" />);
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Inbox' }).getAttribute('aria-current')).toBeNull();
  });

  it('opens a bottom sheet with every remaining destination from More', () => {
    renderWithIntl(<MobileNav slug="demo" role="owner" />);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    const sheet = openMore();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    // Flags are off by default, so invoices, limitation and insights stay hidden.
    expect(moreIds(sheet)).toEqual([
      'tomorrow',
      'calendar',
      'briefs',
      'research',
      'drafts',
      'memory',
      'activity',
      'people',
      'import',
      'courts',
      'notices',
      'portfolio',
      'billing',
      'settings',
    ]);
    for (const link of within(sheet).getAllByRole('link')) {
      expect(link.className).toMatch(/\bmin-h-11\b/);
    }
  });

  it('offers the language switcher in the More sheet, each option in its own script (#175)', () => {
    renderWithIntl(<MobileNav slug="demo" role="owner" />);
    const sheet = openMore();
    const group = within(sheet).getByRole('group', { name: 'Language' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
      'English',
      'தமிழ்',
      'ಕನ್ನಡ',
    ]);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false]);
  });

  it('hides destinations the role cannot see and shows flagged ones when enabled', () => {
    renderWithIntl(<MobileNav slug="demo" role="viewer" isEnabled={() => true} />);
    const ids = moreIds(openMore());
    expect(ids).not.toContain('billing');
    expect(ids).not.toContain('insights');
    expect(ids).not.toContain('settings');
    expect(ids).not.toContain('invoices');
    expect(ids).not.toContain('limitation');
    cleanup();
    renderWithIntl(<MobileNav slug="demo" role="owner" isEnabled={() => true} />);
    expect(moreIds(openMore())).toEqual(
      expect.arrayContaining(['invoices', 'limitation', 'insights']),
    );
  });

  it('closes the sheet when a destination is chosen', () => {
    renderWithIntl(<MobileNav slug="demo" role="owner" />);
    const sheet = openMore();
    fireEvent.click(within(sheet).getByRole('link', { name: 'Courts' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the notification panel from the Notifications entry at the top of the sheet', () => {
    notifications.resetNotificationStores();
    const open = renderHook(() => notifications.useNotificationsOpen());
    renderWithIntl(<MobileNav slug="demo" role="owner" />);
    const sheet = openMore();
    const entry = within(sheet).getByRole('button', { name: 'Notifications' });
    expect(entry.dataset.moreItem).toBe('notifications');
    fireEvent.click(entry);
    expect(screen.queryByRole('dialog', { name: 'More destinations' })).toBeNull();
    expect(open.result.current).toBe(true);
    notifications.resetNotificationStores();
  });

  it('marks More current when the active route lives in the sheet', () => {
    nav.pathname = '/w/demo/courts';
    renderWithIntl(<MobileNav slug="demo" role="owner" />);
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-current')).toBe('page');
    const sheet = openMore();
    expect(within(sheet).getByRole('link', { name: 'Courts' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('uses the ui bottom sheet, whose slide runs on --dur-* tokens (zeroed under reduced motion)', () => {
    renderWithIntl(<MobileNav slug="demo" role="owner" />);
    const sheet = openMore();
    expect(sheet.getAttribute('data-side')).toBe('bottom');
    expect(sheet.className).toContain('data-[state=open]:duration-(--dur-slow)');
    expect(sheet.className).toContain('data-[state=closed]:duration-(--dur-base)');
  });
});
