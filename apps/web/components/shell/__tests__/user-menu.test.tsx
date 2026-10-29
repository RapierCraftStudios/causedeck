// @vitest-environment jsdom
// User menu language group (#175): the shell menu offers English, தமிழ், ಕನ್ನಡ as radio items
// below the theme group, and picking one saves it through the locale switcher's server action.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockMatchMedia, renderWithIntl, stubResizeObserver } from './helpers.tsx';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const setLocaleAction = vi.hoisted(() => vi.fn());
vi.mock('../../../app/(app)/account/actions.ts', () => ({ setLocaleAction }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));

const openHelp = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/shortcuts/provider.tsx', () => ({ useShortcuts: () => ({ openHelp }) }));

const { UserMenu } = await import('../user-menu.tsx');
const { loadShellOverlays } = await import('../use-shell-overlays.ts');

beforeEach(async () => {
  mockMatchMedia();
  stubResizeObserver();
  await loadShellOverlays();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function openMenu() {
  renderWithIntl(
    <UserMenu
      user={{ id: 'u1', name: 'Asha Rao', email: 'asha@example.com' }}
      role="owner"
      slug="demo"
    />,
  );
  const trigger = screen.getByRole('button', { name: /Asha Rao/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return screen.getByRole('menu');
}

describe('user menu language group (#175)', () => {
  it('lists each language in its own script with the active one checked', () => {
    const menu = openMenu();
    expect(within(menu).getByText('Language')).toBeTruthy();
    const options = [...menu.querySelectorAll<HTMLElement>('[data-locale-option]')];
    expect(options.map((option) => [option.getAttribute('lang'), option.textContent])).toEqual([
      ['en', 'English'],
      ['ta', 'தமிழ்'],
      ['kn', 'ಕನ್ನಡ'],
    ]);
    expect(options.map((option) => option.getAttribute('role'))).toEqual([
      'menuitemradio',
      'menuitemradio',
      'menuitemradio',
    ]);
    expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('saves the picked language and refreshes in place', async () => {
    setLocaleAction.mockResolvedValue({ ok: true, data: { locale: 'kn', message: 'x' } });
    const menu = openMenu();
    const kannada = menu.querySelector<HTMLElement>('[data-locale-option="kn"]');
    if (!kannada) throw new Error('missing kn option');
    fireEvent.click(kannada);
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
    expect(setLocaleAction).toHaveBeenCalledWith({ locale: 'kn' });
  });
});

describe('user menu help entry (#94)', () => {
  it('opens the help sheet', () => {
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Help' }));
    expect(openHelp).toHaveBeenCalledTimes(1);
  });
});
