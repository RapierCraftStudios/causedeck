// @vitest-environment jsdom
import type { Block } from '@causedeck/validators';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { insertFact } from '../../../lib/drafting/blocks-edit.ts';
import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { AuthoritiesPanel, authorityText, type PinnedAuthority } from '../authorities-panel.tsx';

afterEach(cleanup);

const withCitation: PinnedAuthority = {
  id: 'n.0',
  label: 'Example v. Sample',
  citation: '2024 SCC OnLine Mad 1234',
};
const bare: PinnedAuthority = { id: 'n.1', label: 'Sample v. Union' };

describe('AuthoritiesPanel', () => {
  it('inserts the chosen authority', () => {
    const onInsert = vi.fn();
    renderWithIntl(
      <AuthoritiesPanel authorities={[withCitation]} selectedSlot="b.0" onInsert={onInsert} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onInsert).toHaveBeenCalledWith('2024 SCC OnLine Mad 1234', withCitation);
  });

  it('is off without a selected block', () => {
    renderWithIntl(<AuthoritiesPanel authorities={[withCitation]} onInsert={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveProperty('disabled', true);
  });

  it('is off when disabled', () => {
    renderWithIntl(
      <AuthoritiesPanel
        authorities={[withCitation]}
        selectedSlot="b.0"
        disabled
        onInsert={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toHaveProperty('disabled', true);
  });

  it('shows the empty state', () => {
    renderWithIntl(<AuthoritiesPanel authorities={[]} onInsert={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/No authorities are pinned/)).toBeTruthy();
  });
});

describe('inserting an authority', () => {
  const blocks: Block[] = [{ type: 'paragraph', text: 'As held in' }];

  it('appends the citation string to the selected paragraph', () => {
    expect(insertFact(blocks, 'b.0', authorityText(withCitation))).toEqual([
      { type: 'paragraph', text: 'As held in 2024 SCC OnLine Mad 1234' },
    ]);
  });

  it('falls back to the label when there is no citation', () => {
    expect(authorityText(bare)).toBe('Sample v. Union');
  });
});
