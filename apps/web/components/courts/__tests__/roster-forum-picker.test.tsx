// @vitest-environment jsdom
// Roster forum picker (#435): a rail of forum links with the selected one `aria-current="page"`, and
// a labelled forum `Select` that navigates to `?forum=<code>`.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';

import { rosterForums } from './fixtures.ts';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { RosterForumPicker, rostersHref } = await import('../roster-forum-picker.tsx');

const MADRAS = 'in.tn.madras-hc.principal.appellate';
const KARNATAKA = 'in.ka.karnataka-hc.bengaluru';

beforeEach(() => {
  router.push.mockReset();
  // Radix Select needs these in jsdom.
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    scrollIntoView: () => undefined,
  });
});
afterEach(cleanup);

describe('RosterForumPicker (#435)', () => {
  it('lists the forums as rail links, the selected one current', () => {
    renderWithIntl(<RosterForumPicker slug="demo" forums={rosterForums()} selected={MADRAS} />);
    const rail = screen.getByRole('navigation', { name: 'Forums with rosters' });
    const links = within(rail).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/w/demo/courts/rosters?forum=${MADRAS}`,
      `/w/demo/courts/rosters?forum=${KARNATAKA}`,
    ]);
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    expect(links[1]?.getAttribute('aria-current')).toBeNull();
    expect(links[1]?.textContent).toContain('High Court of Karnataka, Bengaluru');
  });

  it('navigates to the chosen forum from the Select', () => {
    renderWithIntl(<RosterForumPicker slug="demo" forums={rosterForums()} selected={MADRAS} />);
    const trigger = screen.getByRole('combobox', { name: 'Forum' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'High Court of Karnataka, Bengaluru' }));
    expect(router.push).toHaveBeenCalledWith(`/w/demo/courts/rosters?forum=${KARNATAKA}`);
  });

  it('builds the rosters href', () => {
    expect(rostersHref('my ws')).toBe('/w/my%20ws/courts/rosters');
    expect(rostersHref('demo', 'a.b')).toBe('/w/demo/courts/rosters?forum=a.b');
  });
});
