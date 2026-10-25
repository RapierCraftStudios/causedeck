// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProposalTray, type TrayProposal } from './proposal-tray';

const PROPOSALS: TrayProposal[] = [
  {
    id: 'p1',
    title: 'Papers to carry',
    statement: 'You usually carry the vakalat copy. Remember this?',
    evidence: 'Seen in 3 briefs',
  },
  { id: 'p2', title: 'Brief format', statement: 'One page, headnote first.', evidence: 'Edited 3 times' },
];

function setup(props: Partial<React.ComponentProps<typeof ProposalTray>> = {}) {
  const handlers = { onSave: vi.fn(), onEdit: vi.fn(), onDismiss: vi.fn() };
  render(<ProposalTray proposals={PROPOSALS} {...handlers} {...props} />);
  return handlers;
}

describe('ProposalTray', () => {
  it('shows the count, each proposal and its evidence', () => {
    setup();
    expect(screen.getByRole('heading', { name: '2 suggestions' })).toBeInTheDocument();
    expect(screen.getByText('Seen in 3 briefs')).toBeInTheDocument();
  });

  it('renders nothing without proposals', () => {
    const { container } = render(<ProposalTray proposals={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('saves, edits and dismisses with buttons', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Save: Brief format' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit: Brief format' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss: Brief format' }));
    expect(h.onSave).toHaveBeenCalledWith('p2');
    expect(h.onEdit).toHaveBeenCalledWith('p2');
    expect(h.onDismiss).toHaveBeenCalledWith('p2');
  });

  it('acts on the focused proposal with s, e and x', async () => {
    const h = setup();
    screen.getByRole('listitem', { name: 'Papers to carry' }).focus();
    await userEvent.keyboard('s');
    await userEvent.keyboard('e');
    await userEvent.keyboard('x');
    expect(h.onSave).toHaveBeenCalledExactlyOnceWith('p1');
    expect(h.onEdit).toHaveBeenCalledExactlyOnceWith('p1');
    expect(h.onDismiss).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('ignores the keys when offline, view only or outside a proposal', async () => {
    const h = setup({ offline: true });
    screen.getByRole('listitem', { name: 'Papers to carry' }).focus();
    await userEvent.keyboard('s');
    expect(h.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save: Brief format' })).toBeDisabled();
  });

  it('hides the actions for a view-only role', () => {
    setup({ viewOnly: true });
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(screen.getByText('View only')).toBeInTheDocument();
  });
});
