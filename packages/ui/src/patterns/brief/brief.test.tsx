// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ProvenanceLink,
  assertProvenance,
  footnoteText,
  type SourcedLine,
} from './provenance-link';
import { ReadinessMeter } from './readiness-meter';
import { SectionLabel, SheetPage } from './sheet-page';

const ANCHORED: SourcedLine = {
  source_type: 'document',
  source_ref: null,
  anchor_id: '7b0a6a3e-0f3e-4f65-9d5b-2c1b8f3a9d11',
  confidence: 0.9,
  confirmation_state: 'confirmed',
  page_no: 3,
  quote: 'Notice ordered.',
};

describe('brief patterns (#61)', () => {
  it('rejects a line that has no anchor, no source reference and is not manual', () => {
    const bare = { source_type: 'document' as const, source_ref: null, anchor_id: null };
    expect(() => {
      assertProvenance(bare);
    }).toThrow(/anchor or a source reference/);
    expect(() =>
      render(
        <ProvenanceLink
          sourceLabel="Order"
          line={{ ...ANCHORED, source_type: 'document', anchor_id: null, source_ref: null }}
        />,
      ),
    ).toThrow(/anchor or a source reference/);
  });

  it('accepts an anchored, a referenced and a manual line', () => {
    expect(() => {
      assertProvenance(ANCHORED);
    }).not.toThrow();
    expect(() => {
      assertProvenance({ ...ANCHORED, anchor_id: null, source_ref: 'doc:1' });
    }).not.toThrow();
    expect(() => {
      assertProvenance({ source_type: 'manual', source_ref: null, anchor_id: null });
    }).not.toThrow();
  });

  it('shows the chip on screen and a short footnote for print', () => {
    const { container } = render(<ProvenanceLink line={ANCHORED} sourceLabel="Order of 12 Aug" />);
    expect(screen.getByRole('button', { name: /^Source: Order of 12 Aug/ })).toBeTruthy();
    expect(container.querySelector('[data-slot="provenance-footnote"]')?.textContent).toBe(
      '[Order of 12 Aug, p. 3]',
    );
    expect(footnoteText('Order', null)).toBe('Order');
  });

  it('renders the sheet as an article with an h2 section label', () => {
    render(
      <SheetPage>
        <SectionLabel>Last order</SectionLabel>
      </SheetPage>,
    );
    expect(screen.getByRole('article')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Last order' })).toBeTruthy();
  });

  it('the readiness meter has a meter role with a text equivalent', () => {
    render(
      <ReadinessMeter
        score={50}
        label="Ready 50 of 100"
        segments={[
          { key: 'a', label: 'Stage known', met: true },
          { key: 'b', label: 'Order confirmed', met: false },
        ]}
      />,
    );
    const meter = screen.getByRole('meter', { name: 'Ready 50 of 100' });
    expect(meter.getAttribute('aria-valuenow')).toBe('50');
  });
});
