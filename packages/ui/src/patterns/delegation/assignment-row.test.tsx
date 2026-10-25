// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AssignmentRow } from './assignment-row';

const MEMBERS = [
  { id: 'm1', name: 'Asha Rao' },
  { id: 'm2', name: 'Vikram Shah' },
];

const row = (onAssign = vi.fn()) => (
  <ul>
    <AssignmentRow
      title="12 · Rao v. State"
      members={MEMBERS}
      assigneeId={null}
      flag="unassigned"
      onAssign={onAssign}
    />
  </ul>
);

describe('AssignmentRow', () => {
  it('assigns with a, arrow keys and Enter', async () => {
    const onAssign = vi.fn();
    const user = userEvent.setup();
    render(row(onAssign));
    screen.getByRole('listitem').focus();
    await user.keyboard('a');
    expect(screen.getByLabelText('Assignee')).toHaveFocus();
    await user.selectOptions(screen.getByLabelText('Assignee'), 'm2');
    await user.keyboard('{Enter}');
    expect(onAssign).toHaveBeenCalledExactlyOnceWith('m2');
  });

  it('shows Will sync while queued and does not assign when disabled', () => {
    const onAssign = vi.fn();
    render(
      <ul>
        <AssignmentRow
          title="x"
          members={MEMBERS}
          assigneeId="m1"
          sync="queued"
          disabled
          onAssign={onAssign}
        />
      </ul>,
    );
    expect(screen.getByText('Will sync')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });
});
