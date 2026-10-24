// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { NoticeList, type NoticeView } from '../notice-list.tsx';

afterEach(cleanup);

function notice(overrides: Partial<NoticeView> = {}): NoticeView {
  return {
    id: 'n-1',
    title: 'Holiday list for 2027 of Madurai Bench',
    kind: 'holiday',
    issuedOn: '2026-11-05',
    effectiveOn: '2027-01-01',
    url: 'https://mhc.example.test/notices/holiday-2027.pdf',
    forumCodes: ['in.tn.madras-hc.madurai'],
    sourceName: 'Madras High Court',
    recordedOn: '2026-11-06',
    matterCount: 2,
    ...overrides,
  };
}

describe('NoticeList (#588)', () => {
  it('shows kind, dates, forums, matters, provenance and the official link', () => {
    const { container } = renderWithIntl(<NoticeList notices={[notice()]} />);
    const row = container.querySelector('[data-notice="n-1"]');
    expect(row?.textContent).toContain('Holiday list');
    expect(row?.textContent).toContain('Issued 2026-11-05');
    expect(row?.textContent).toContain('Effective 2027-01-01');
    expect(row?.textContent).toContain('in.tn.madras-hc.madurai');
    expect(row?.textContent).toContain('Affects 2 of your matters');
    expect(row?.querySelector('[data-provenance="source"]')?.textContent).toBe(
      'Source: Madras High Court, recorded 2026-11-06',
    );
    const link = screen.getByRole('link', { name: /Open the official notice/ });
    expect(link.getAttribute('href')).toBe('https://mhc.example.test/notices/holiday-2027.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('never links a URL that is not http(s)', () => {
    renderWithIntl(<NoticeList notices={[notice({ url: 'javascript:alert(1)' })]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeTruthy();
  });

  it('the compact form leaves out forums and matter counts', () => {
    const { container } = renderWithIntl(<NoticeList notices={[notice()]} compact />);
    expect(container.textContent).not.toContain('Forums:');
    expect(container.textContent).not.toContain('Affects');
    expect(container.querySelector('[data-provenance="source"]')).not.toBeNull();
  });
});
