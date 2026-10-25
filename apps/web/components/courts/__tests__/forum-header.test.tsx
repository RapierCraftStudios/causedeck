// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { ForumHeader } from '../forum-header.tsx';

import { forum, forumRow } from './fixtures.ts';

afterEach(cleanup);

const at = new Date('2026-10-21T04:00:00Z');

describe('ForumHeader (#400)', () => {
  it('shows the place, level with its sentence, side, languages and status text', () => {
    const { container } = renderWithIntl(
      <ForumHeader forum={forumRow()} slug="demo" latestParse={null} officialList={null} />,
    );
    expect(container.textContent).toContain('Principal Seat, Appellate Side, Chennai');
    expect(
      container.querySelector('[data-adapter-level="A1"] [data-slot="adapter-level-description"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-forum-side="appellate"]')?.textContent).toBe(
      'Appellate side',
    );
    expect(container.querySelector('[data-forum-language="ta"]')?.getAttribute('lang')).toBe('ta');
    expect(container.querySelector('[data-forum-status="none"]')?.textContent).toBe('No lists yet');
    expect(container.querySelector('[data-forum-banner]')).toBeNull();
  });

  it('shows the degraded banner as on the card', () => {
    const { container } = renderWithIntl(
      <ForumHeader
        forum={forumRow()}
        slug="demo"
        latestParse={{ status: 'degraded', at, hallsUnreadable: ['7'] }}
        officialList={forum().officialList}
      />,
    );
    expect(container.querySelector('[data-forum-status="degraded"]')?.textContent).toBe(
      'Partly read',
    );
    const banner = container.querySelector('[data-forum-banner="degraded"]');
    expect(banner?.textContent).toContain("Couldn't read today's list for Hall 7");
    expect(banner?.querySelector('[data-forum-official]')?.getAttribute('target')).toBe('_blank');
  });

  it('marks Tamil text with lang and tags a workspace forum', () => {
    const { container } = renderWithIntl(
      <ForumHeader
        forum={forumRow({ establishment: 'சென்னை', seat: null, workspaceId: 'ws-1' })}
        slug="demo"
        latestParse={null}
        officialList={null}
      />,
    );
    expect(container.querySelector('span[lang="ta"]')?.textContent).toBe('சென்னை');
    expect(container.textContent).toContain('Your forum');
  });
});
