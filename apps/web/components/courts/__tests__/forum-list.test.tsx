// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { renderWithIntl } = await import('../../shell/__tests__/helpers.tsx');
const { ForumList } = await import('../forum-list.tsx');
const { sampleIndex } = await import('./fixtures.ts');

beforeEach(() => {
  router.push.mockReset();
});

afterEach(cleanup);

const links = () => [...document.querySelectorAll<HTMLAnchorElement>('[data-forum-link]')];
const tabbable = () => links().filter((link) => link.tabIndex === 0);
const codeOf = (el: Element | null) => el?.getAttribute('data-forum-link');

describe('ForumList (#399)', () => {
  it('groups forums by city then court', () => {
    renderWithIntl(<ForumList slug="demo" index={sampleIndex()} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Bengaluru',
      'Chennai',
      'Planned',
    ]);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Karnataka High Court',
      'City Civil Court',
      'Madras High Court',
    ]);
  });

  it('is one grid with a single tab stop (roving tabindex)', () => {
    renderWithIntl(<ForumList slug="demo" index={sampleIndex()} />);
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    expect(screen.getAllByRole('gridcell')).toHaveLength(5);
    expect(tabbable().map(codeOf)).toEqual(['in.ka.karnataka-hc.bengaluru']);
  });

  it('moves with arrow keys, Home and End, and opens with Enter', () => {
    renderWithIntl(<ForumList slug="demo" index={sampleIndex()} />);
    const [first] = links();
    first?.focus();
    const press = (key: string) => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key });
      return codeOf(document.activeElement);
    };
    expect(press('ArrowRight')).toBe('in.ka.bengaluru.city-civil');
    expect(press('ArrowDown')).toBe('in.tn.madras-hc.principal.original');
    expect(press('ArrowUp')).toBe('in.ka.bengaluru.city-civil');
    expect(press('ArrowLeft')).toBe('in.ka.karnataka-hc.bengaluru');
    expect(press('ArrowLeft')).toBe('in.ka.karnataka-hc.bengaluru');
    expect(press('End')).toBe('in.tn.madras-hc.extra');
    expect(press('ArrowRight')).toBe('in.tn.madras-hc.extra');
    expect(tabbable().map(codeOf)).toEqual(['in.tn.madras-hc.extra']);
    expect(press('Home')).toBe('in.ka.karnataka-hc.bengaluru');
    press('Enter');
    expect(router.push).toHaveBeenCalledWith('/w/demo/courts/in.ka.karnataka-hc.bengaluru');
  });

  it('marks its search for the `/` shortcut and filters the cards', () => {
    renderWithIntl(<ForumList slug="demo" index={sampleIndex()} />);
    const search = screen.getByRole('searchbox', { name: 'Search forums' });
    expect(search.hasAttribute('data-page-search')).toBe(true);
    fireEvent.change(search, { target: { value: 'appellate' } });
    expect(links().map(codeOf)).toEqual(['in.tn.madras-hc.principal.appellate']);
    expect(tabbable()).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'nowhere' } });
    expect(links()).toHaveLength(0);
    expect(document.querySelector('[data-forum-no-match]')?.textContent).toBe(
      'No forum matches “nowhere”.',
    );
  });

  it('lists planned forums with their reason and no links', () => {
    renderWithIntl(<ForumList slug="demo" index={sampleIndex()} />);
    const planned = document.querySelector('[data-courts-planned]');
    const items = [...(planned?.querySelectorAll('[data-planned-forum]') ?? [])];
    expect(items.map((item) => item.getAttribute('data-planned-forum'))).toEqual([
      'in.tn.madras-hc.madurai',
      'in.ka.karnataka-hc.dharwad',
      'in.ka.karnataka-hc.kalaburagi',
    ]);
    expect(items[0]?.textContent).toContain('Needs its own adapter configuration.');
    expect(items[2]?.textContent).toContain('Not available yet.');
    expect(planned?.querySelector('a')).toBeNull();
  });
});
