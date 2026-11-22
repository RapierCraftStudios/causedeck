// @vitest-environment jsdom
// The Citations panel holds every unacknowledged citation that is not verified (#1136), so an
// `unknown` row alone still shows the export hold and the acknowledge button.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { CitationPanel, type CitationView } from '../citation-panel.tsx';

afterEach(cleanup);

const row = (id: string, status: CitationView['status'], acknowledged = false): CitationView => ({
  id,
  blockId: 'b1',
  raw: `(2019) 5 SCC ${id}`,
  status,
  acknowledged,
});

function renderPanel(citations: CitationView[]) {
  const onAcknowledge = vi.fn();
  renderWithIntl(
    <CitationPanel
      citations={citations}
      onCheck={vi.fn()}
      onJump={vi.fn()}
      onAcknowledge={onAcknowledge}
    />,
  );
  return onAcknowledge;
}

describe('CitationPanel export hold', () => {
  it('counts unknown and not_found rows that nobody acknowledged', () => {
    const onAcknowledge = renderPanel([
      row('1', 'verified'),
      row('2', 'not_found'),
      row('3', 'unknown'),
      row('4', 'unknown', true),
    ]);
    expect(screen.getByRole('status').textContent).toContain('2 citations');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge not-found citations' }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('offers the acknowledgement for an unknown row on its own', () => {
    renderPanel([row('1', 'verified'), row('2', 'unknown')]);
    expect(screen.getByRole('button', { name: 'Acknowledge not-found citations' })).toBeTruthy();
  });

  it('shows no hold when everything is verified or acknowledged', () => {
    renderPanel([row('1', 'verified'), row('2', 'unknown', true)]);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
