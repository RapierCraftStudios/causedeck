// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CITATION_STATUS_MAP, CITATION_STATUS_ORDER, CitationStatus } from './citation-status';

describe('CitationStatus', () => {
  it.each(CITATION_STATUS_ORDER)('%s shows a glyph and its text label', (status) => {
    const { container, getByText } = render(<CitationStatus status={status} />);
    expect(getByText(CITATION_STATUS_MAP[status].label)).toBeTruthy();
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-status')).toBe(status);
    const icon = root.querySelector('[data-slot="citation-status-icon"]');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses plain labels for the three outcomes', () => {
    expect(CITATION_STATUS_ORDER.map((s) => CITATION_STATUS_MAP[s].label)).toEqual([
      'Verified',
      'Not found',
      'Unknown',
    ]);
  });

  it('takes a translated label and extra classes', () => {
    const { getByText, container } = render(
      <CitationStatus status="verified" label="சரிபார்க்கப்பட்டது" className="extra" />,
    );
    expect(getByText('சரிபார்க்கப்பட்டது')).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).className).toContain('extra');
  });
});
