// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { ParseBanner } from '../parse-banner.tsx';

import { forum } from './fixtures.ts';

afterEach(cleanup);

const at = new Date('2026-10-21T04:00:00Z');
const { code, officialList } = forum();

describe('ParseBanner (#400)', () => {
  it.each([null, { status: 'ok' as const, at, hallsUnreadable: [] }])(
    'renders nothing unless the last list was degraded or failed (%#)',
    (latestParse) => {
      const { container } = renderWithIntl(
        <ParseBanner
          code={code}
          slug="demo"
          latestParse={latestParse}
          officialList={officialList}
        />,
      );
      expect(container.innerHTML).toBe('');
    },
  );

  it('names the unreadable halls with the official-list and share actions', () => {
    const { container } = renderWithIntl(
      <ParseBanner
        code={code}
        slug="demo"
        latestParse={{ status: 'failed', at, hallsUnreadable: ['7', '9'] }}
        officialList={officialList}
      />,
    );
    const banner = container.querySelector('[data-forum-banner="failed"]');
    expect(banner?.textContent).toContain("Couldn't read today's list for Halls 7, 9");
    const official = container.querySelector(`[data-forum-official="${code}"]`);
    expect(official?.getAttribute('target')).toBe('_blank');
    expect(official?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.querySelector(`[data-forum-share="${code}"]`)?.getAttribute('href')).toBe(
      '/w/demo/inbox',
    );
  });

  it('omits the official link without one', () => {
    const { container } = renderWithIntl(
      <ParseBanner
        code={code}
        slug="demo"
        latestParse={{ status: 'degraded', at, hallsUnreadable: [] }}
        officialList={null}
      />,
    );
    expect(container.querySelector('[data-forum-banner="degraded"]')?.textContent).toContain(
      "Couldn't read today's list",
    );
    expect(container.querySelector('[data-forum-official]')).toBeNull();
  });
});
