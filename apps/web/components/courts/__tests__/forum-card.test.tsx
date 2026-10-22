// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { ForumCard, scriptLang } from '../forum-card.tsx';

import { forum } from './fixtures.ts';

afterEach(cleanup);

const at = new Date('2026-10-21T04:00:00Z');

describe('ForumCard (#399)', () => {
  it('shows the level badge, side, language chips and links to the forum', () => {
    const { container } = renderWithIntl(
      <ForumCard
        slug="demo"
        forum={forum({ languageProfile: { primary: 'en', secondary: ['ta'] } })}
      />,
    );
    expect(container.querySelector('[data-adapter-level="A1"]')).not.toBeNull();
    expect(container.querySelector('[data-forum-side="appellate"]')?.textContent).toBe(
      'Appellate side',
    );
    const chips = [...container.querySelectorAll('[data-forum-language]')];
    expect(chips.map((chip) => [chip.getAttribute('lang'), chip.textContent])).toEqual([
      ['en', 'English'],
      ['ta', 'தமிழ்'],
    ]);
    expect(container.querySelector('[data-forum-link]')?.getAttribute('href')).toBe(
      '/w/demo/courts/in.tn.madras-hc.principal.appellate',
    );
  });

  it.each([
    [null, 'none', 'No lists yet'],
    [{ status: 'ok', at, hallsUnreadable: [] }, 'ok', 'Lists read'],
    [{ status: 'degraded', at, hallsUnreadable: ['7'] }, 'degraded', 'Partly read'],
    [{ status: 'failed', at, hallsUnreadable: [] }, 'failed', "Couldn't read"],
  ] as const)('pairs the status dot with text (%#)', (latestParse, status, text) => {
    const { container } = renderWithIntl(
      <ForumCard
        slug="demo"
        forum={forum({
          latestParse:
            latestParse === null
              ? null
              : { ...latestParse, hallsUnreadable: [...latestParse.hallsUnreadable] },
        })}
      />,
    );
    const row = container.querySelector(`[data-forum-status="${status}"]`);
    expect(row?.querySelector('[data-slot="status-dot"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(row?.textContent).toBe(text);
  });

  it('shows no banner when the last list was read', () => {
    const { container } = renderWithIntl(
      <ForumCard
        slug="demo"
        forum={forum({ latestParse: { status: 'ok', at, hallsUnreadable: [] } })}
      />,
    );
    expect(container.querySelector('[data-forum-banner]')).toBeNull();
  });

  it('names the unreadable hall, opens the official list in a new window and shares to the Inbox', () => {
    const { container } = renderWithIntl(
      <ForumCard
        slug="demo"
        forum={forum({ latestParse: { status: 'degraded', at, hallsUnreadable: ['7'] } })}
      />,
    );
    const banner = container.querySelector('[data-forum-banner="degraded"]');
    expect(banner?.textContent).toContain("Couldn't read today's list for Hall 7");
    const official = screen.getByRole('link', { name: /Open the official list/ });
    expect(official.getAttribute('href')).toBe('https://court.example/cause_list.php');
    expect(official.getAttribute('target')).toBe('_blank');
    expect(official.getAttribute('rel')).toBe('noopener noreferrer');
    expect(official.textContent).toContain("Opens the court's website in a new window");
    expect(screen.getByRole('link', { name: 'Share it again' }).getAttribute('href')).toBe(
      '/w/demo/inbox',
    );
    // Links never nest: the banner actions sit beside the card's main link.
    expect(container.querySelector('a a')).toBeNull();
  });

  it('lists several halls and drops the official link when the forum has none', () => {
    const { container } = renderWithIntl(
      <ForumCard
        slug="demo"
        forum={forum({
          officialList: null,
          latestParse: { status: 'failed', at, hallsUnreadable: ['2', '12A'] },
        })}
      />,
    );
    expect(container.querySelector('[data-forum-banner="failed"]')?.textContent).toContain(
      "Couldn't read today's list for Halls 2, 12A",
    );
    expect(container.querySelector('[data-forum-official]')).toBeNull();
    expect(container.querySelector('[data-forum-share]')).not.toBeNull();
  });

  it('gives Tamil and Kannada names their lang, English none', () => {
    const { container } = renderWithIntl(
      <>
        <ForumCard
          slug="demo"
          forum={forum({ code: 'ta', court: 'சென்னை நீதிமன்றம்', establishment: null })}
        />
        <ForumCard
          slug="demo"
          forum={forum({ code: 'kn', court: 'ಬೆಂಗಳೂರು ನ್ಯಾಯಾಲಯ', establishment: null })}
        />
      </>,
    );
    const names = [...container.querySelectorAll('[data-forum-link] .font-serif')];
    expect(names.map((name) => name.getAttribute('lang'))).toEqual(['ta', 'kn']);
    expect(scriptLang('Madras High Court')).toBeUndefined();
  });
});
