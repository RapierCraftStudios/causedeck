// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { DeepLinkList } from '../deep-link-list.tsx';

import { forumDetail } from './fixtures.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CAPTCHA =
  "The court's page may ask you to solve a captcha. That is the court's requirement; Lawyer OS never solves it for you.";

describe('DeepLinkList (#400)', () => {
  it('renders new-window anchors with an icon and visible text', () => {
    const { container } = renderWithIntl(<DeepLinkList links={forumDetail().deepLinks} />);
    const anchors = [...container.querySelectorAll('a')];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      'https://court.example/cause_list.php',
      'https://court.example/case_status.php',
    ]);
    for (const a of anchors) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(a.textContent).toContain("Opens the court's website in a new window");
    }
    expect(screen.getByRole('link', { name: /Cause list/ })).toBeTruthy();
  });

  it('shows the captcha notice only on captcha-gated links', () => {
    const { container } = renderWithIntl(<DeepLinkList links={forumDetail().deepLinks} />);
    expect(
      container.querySelector('[data-deep-link="case_status"] [data-captcha-notice]')?.textContent,
    ).toBe(CAPTCHA);
    expect(
      container.querySelector('[data-deep-link="cause_list"] [data-captcha-notice]'),
    ).toBeNull();
  });

  it('never frames, embeds or fetches a court page', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { container } = renderWithIntl(<DeepLinkList links={forumDetail().deepLinks} />);
    expect(container.querySelector('iframe, embed, object, frame')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says so when the forum lists no official pages', () => {
    const { container } = renderWithIntl(<DeepLinkList links={[]} />);
    expect(container.querySelector('[data-deep-links-empty]')).not.toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});
