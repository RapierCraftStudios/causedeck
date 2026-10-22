// @vitest-environment jsdom
// Bench-change banner (#435): one item per open alert, the matter linked to its page, a warning
// icon plus the text "Bench changed" (not colour alone), calm copy with the new bench and the
// previous one, nothing when there are no alerts, and the quiet empty panel.
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { BenchChangeBanner, matterHref } from '../bench-change-banner.tsx';

import { benchChanges } from './fixtures.ts';

afterEach(cleanup);

describe('BenchChangeBanner (#435)', () => {
  it('lists each alert with a link to its matter', () => {
    renderWithIntl(<BenchChangeBanner slug="demo" alerts={benchChanges()} />);
    const region = screen.getByRole('region', { name: 'Bench changes' });
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const link = within(items[0] as HTMLElement).getByRole('link', {
      name: 'Raman v. State (fictional)',
    });
    expect(link.getAttribute('href')).toBe('/w/demo/matters/matter-1');
    expect(items[0]?.textContent).toContain(
      'Bench changed from 05 Oct: Raman v. State (fictional) now sits with Justice B. Kural (fictional), Justice C. Ilai (fictional).',
    );
    expect(items[0]?.textContent).toContain('Previously Justice A. Venpa (fictional).');
  });

  it('marks each alert with an icon and text, on the warning tokens', () => {
    renderWithIntl(<BenchChangeBanner slug="demo" alerts={benchChanges().slice(0, 1)} />);
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('Bench changed')).toBeTruthy();
    expect(item.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(item.className).toContain('bg-warning-soft');
  });

  it('words an alert with no previous bench and a bench with no judges recorded', () => {
    renderWithIntl(<BenchChangeBanner slug="demo" alerts={benchChanges().slice(1)} />);
    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('now sits with a bench with no judges recorded.');
    expect(item.textContent).toContain('No bench was recorded for it before.');
  });

  it('renders nothing without alerts, or the quiet empty panel when asked', () => {
    const { container } = renderWithIntl(<BenchChangeBanner slug="demo" alerts={[]} />);
    expect(container.innerHTML).toBe('');
    cleanup();
    renderWithIntl(<BenchChangeBanner slug="demo" alerts={[]} showEmpty />);
    expect(screen.getByText('No open bench changes.')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('encodes the matter link', () => {
    expect(matterHref('my ws', 'a/b')).toBe('/w/my%20ws/matters/a%2Fb');
  });
});
