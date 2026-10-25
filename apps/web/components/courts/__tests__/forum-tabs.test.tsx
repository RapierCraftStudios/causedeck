// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';

const nav = vi.hoisted(() => ({
  pathname: '/w/demo/courts/in.tn.madras-hc.principal.appellate/halls',
}));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

const { ForumTabs, forumTabHref } = await import('../forum-tabs.tsx');

afterEach(cleanup);

const code = 'in.tn.madras-hc.principal.appellate';

describe('ForumTabs (#400)', () => {
  it('lists Halls, Adapter and Links and hides the Rosters slot', () => {
    renderWithIntl(<ForumTabs slug="demo" code={code} />);
    const tabs = within(screen.getByRole('navigation', { name: 'Forum sections' }));
    expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Halls',
      'Adapter',
      'Links',
    ]);
    expect(tabs.queryByRole('link', { name: 'Rosters' })).toBeNull();
    expect(tabs.getByRole('link', { name: 'Adapter' }).getAttribute('href')).toBe(
      forumTabHref('demo', code, 'adapter'),
    );
  });

  it('marks the current tab with aria-current', () => {
    nav.pathname = `/w/demo/courts/${code}/links`;
    renderWithIntl(<ForumTabs slug="demo" code={code} />);
    expect(screen.getByRole('link', { name: 'Links' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Halls' }).getAttribute('aria-current')).toBeNull();
  });

  it('renders the Rosters link to the rosters page with the forum selected (#435)', () => {
    renderWithIntl(
      <ForumTabs slug="demo" code={code} rostersHref={`/w/demo/courts/rosters?forum=${code}`} />,
    );
    const rosters = screen.getByRole('link', { name: 'Rosters' });
    expect(rosters.getAttribute('href')).toBe(`/w/demo/courts/rosters?forum=${code}`);
    expect(rosters.getAttribute('aria-current')).toBeNull();
  });
});
